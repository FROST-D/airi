import type { RedisOptions } from 'ioredis'

import type { IL0Provider } from '../interfaces/multilevel-memory.interface'
import type { L0Config } from '../types/multilevel-config'
import type { L0Message, L0PinnedFact, L0SessionSummary, L0WorkingSet } from '../types/multilevel-types'

import Redis from 'ioredis'

const DEFAULT_MAX_MESSAGES = 12
const DEFAULT_MAX_SUMMARY_TOKENS = 300
const DEFAULT_MAX_PINNED_FACTS_TOKENS = 200

export interface L0ProviderOptions extends L0Config {
  client?: Redis
}

export class L0Provider implements IL0Provider {
  private readonly config: L0Config
  private readonly redis?: Redis
  private readonly memoryStore: Map<string, { messages: L0Message[], summary?: L0SessionSummary, pinnedFacts: L0PinnedFact[] }>

  constructor(options: L0ProviderOptions) {
    this.config = {
      enabled: true,
      maxMessages: options.maxMessages ?? DEFAULT_MAX_MESSAGES,
      maxSessionSummaryTokens: options.maxSessionSummaryTokens ?? DEFAULT_MAX_SUMMARY_TOKENS,
      pinnedFactsMaxTokens: options.pinnedFactsMaxTokens ?? DEFAULT_MAX_PINNED_FACTS_TOKENS,
      storage: options.storage,
      redis: options.redis,
    }

    this.memoryStore = new Map()

    if (this.config.storage === 'redis') {
      this.redis = options.client ?? this.createRedisClient(options.redis)
    }
  }

  async initialize(): Promise<void> {
    if (this.redis) {
      console.info('[L0Provider] Initializing Redis connection...')
      try {
        if (this.redis.status === 'wait') {
          await this.redis.connect()
        }
        await this.redis.ping()
        console.info('[L0Provider] Redis connection established')
      }
      catch (error) {
        console.error('[L0Provider] Redis connection failed:', error)
        throw error
      }
    }
    else {
      console.info('[L0Provider] Using in-memory storage')
    }
  }

  async addMessage(sessionId: string, message: L0Message): Promise<void> {
    const key = this.getSessionKey(sessionId)

    if (this.redis) {
      const messagesKey = `${key}:messages`
      const messageJson = JSON.stringify(message)
      await this.redis.lpush(messagesKey, messageJson)
      await this.redis.ltrim(messagesKey, 0, (this.config.maxMessages ?? DEFAULT_MAX_MESSAGES) - 1)
    }
    else {
      const session = this.memoryStore.get(sessionId) ?? { messages: [], pinnedFacts: [] }
      session.messages.unshift(message)
      if (session.messages.length > (this.config.maxMessages ?? DEFAULT_MAX_MESSAGES)) {
        session.messages = session.messages.slice(0, this.config.maxMessages ?? DEFAULT_MAX_MESSAGES)
      }
      this.memoryStore.set(sessionId, session)
    }
  }

  async getMessages(sessionId: string, limit?: number): Promise<L0Message[]> {
    const maxLimit = limit ?? (this.config.maxMessages ?? DEFAULT_MAX_MESSAGES)
    const key = this.getSessionKey(sessionId)

    if (this.redis) {
      const messagesKey = `${key}:messages`
      const messages = await this.redis.lrange(messagesKey, 0, maxLimit - 1)
      return messages.map(msg => JSON.parse(msg) as L0Message)
    }
    else {
      const session = this.memoryStore.get(sessionId)
      if (!session) {
        return []
      }
      return session.messages.slice(0, maxLimit)
    }
  }

  async setSessionSummary(sessionId: string, summary: L0SessionSummary): Promise<void> {
    const key = this.getSessionKey(sessionId)

    if (this.redis) {
      const summaryKey = `${key}:summary`
      await this.redis.set(summaryKey, JSON.stringify(summary))
    }
    else {
      const session = this.memoryStore.get(sessionId) ?? { messages: [], pinnedFacts: [] }
      session.summary = summary
      this.memoryStore.set(sessionId, session)
    }
  }

  async getSessionSummary(sessionId: string): Promise<L0SessionSummary | null> {
    const key = this.getSessionKey(sessionId)

    if (this.redis) {
      const summaryKey = `${key}:summary`
      const summary = await this.redis.get(summaryKey)
      return summary ? JSON.parse(summary) as L0SessionSummary : null
    }
    else {
      const session = this.memoryStore.get(sessionId)
      return session?.summary ?? null
    }
  }

  async setPinnedFact(sessionId: string, fact: L0PinnedFact): Promise<void> {
    const key = this.getSessionKey(sessionId)

    if (this.redis) {
      const factsKey = `${key}:pinnedFacts`
      await this.redis.hset(factsKey, fact.key, JSON.stringify(fact))
    }
    else {
      const session = this.memoryStore.get(sessionId) ?? { messages: [], pinnedFacts: [] }
      const existingIndex = session.pinnedFacts.findIndex(f => f.key === fact.key)
      if (existingIndex >= 0) {
        session.pinnedFacts[existingIndex] = fact
      }
      else {
        session.pinnedFacts.push(fact)
      }
      this.memoryStore.set(sessionId, session)
    }
  }

  async getPinnedFacts(sessionId: string): Promise<L0PinnedFact[]> {
    const key = this.getSessionKey(sessionId)

    if (this.redis) {
      const factsKey = `${key}:pinnedFacts`
      const facts = await this.redis.hgetall(factsKey)
      return Object.values(facts).map(f => JSON.parse(f) as L0PinnedFact)
    }
    else {
      const session = this.memoryStore.get(sessionId)
      return session?.pinnedFacts ?? []
    }
  }

  async removePinnedFact(sessionId: string, key: string): Promise<void> {
    const sessionKey = this.getSessionKey(sessionId)

    if (this.redis) {
      const factsKey = `${sessionKey}:pinnedFacts`
      await this.redis.hdel(factsKey, key)
    }
    else {
      const session = this.memoryStore.get(sessionId)
      if (session) {
        session.pinnedFacts = session.pinnedFacts.filter(f => f.key !== key)
        this.memoryStore.set(sessionId, session)
      }
    }
  }

  async getWorkingSet(sessionId: string): Promise<L0WorkingSet> {
    const [messages, summary, pinnedFacts] = await Promise.all([
      this.getMessages(sessionId),
      this.getSessionSummary(sessionId),
      this.getPinnedFacts(sessionId),
    ])

    const totalTokens = this.calculateTotalTokens(messages, summary, pinnedFacts)

    return {
      messages,
      sessionSummary: summary ?? undefined,
      pinnedFacts,
      totalTokens,
    }
  }

  async clearSession(sessionId: string): Promise<void> {
    const key = this.getSessionKey(sessionId)

    if (this.redis) {
      const keys = await this.redis.keys(`${key}:*`)
      if (keys.length > 0) {
        await this.redis.del(...keys)
      }
    }
    else {
      this.memoryStore.delete(sessionId)
    }
  }

  private getSessionKey(sessionId: string): string {
    const namespace = this.config.redis?.namespace ?? 'airi:memory:L0'
    return `${namespace}:${sessionId}`
  }

  private createRedisClient(options?: L0Config['redis']): Redis {
    const config: RedisOptions = {
      lazyConnect: true,
      host: options?.host ?? 'localhost',
      port: options?.port ?? 6379,
      password: options?.password,
    }

    return new Redis(config)
  }

  private calculateTotalTokens(
    messages: L0Message[],
    summary: L0SessionSummary | null,
    pinnedFacts: L0PinnedFact[],
  ): number {
    const messagesTokens = messages.reduce((sum, msg) => sum + (msg.tokenCount ?? this.estimateTokens(msg.content)), 0)
    const summaryTokens = summary?.tokenCount ?? 0
    const factsTokens = pinnedFacts.reduce((sum, fact) => sum + fact.tokenCount, 0)
    return messagesTokens + summaryTokens + factsTokens
  }

  private estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4)
  }
}

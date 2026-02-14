import type { RedisOptions } from 'ioredis'
import type { Pool, PoolConfig } from 'pg'

import type { IL1Provider } from '../interfaces/multilevel-memory.interface'
import type { L1Config } from '../types/multilevel-config'
import type { L1Message, L1Session } from '../types/multilevel-types'

import Redis from 'ioredis'

import { Pool as PgPool } from 'pg'

const DEFAULT_SESSION_DURATION_HOURS = 24
const DEFAULT_CACHE_SIZE = 1000

export interface L1ProviderOptions extends L1Config {
  redisClient?: Redis
  postgresPool?: Pool
}

export class L1Provider implements IL1Provider {
  private readonly config: L1Config
  private readonly redis?: Redis
  private readonly postgres?: Pool
  private readonly cache: Map<string, L1Message[]>
  private readonly cacheSize: number

  constructor(options: L1ProviderOptions) {
    this.config = {
      enabled: true,
      sessionDurationHours: options.sessionDurationHours ?? DEFAULT_SESSION_DURATION_HOURS,
      maxMessagesPerSession: options.maxMessagesPerSession,
      cacheEnabled: options.cacheEnabled ?? true,
      cacheSize: options.cacheSize ?? DEFAULT_CACHE_SIZE,
      storage: options.storage,
      redis: options.redis,
      postgres: options.postgres,
    }

    this.cacheSize = this.config.cacheSize ?? DEFAULT_CACHE_SIZE
    this.cache = new Map()

    if (this.config.storage === 'redis' || this.config.storage === 'both') {
      this.redis = options.redisClient ?? this.createRedisClient(options.redis)
    }

    if (this.config.storage === 'postgres' || this.config.storage === 'both') {
      this.postgres = options.postgresPool ?? this.createPostgresPool(options.postgres)
    }
  }

  async initialize(): Promise<void> {
    console.info('[L1Provider] Initializing...')

    if (this.redis) {
      try {
        if (this.redis.status === 'wait') {
          await this.redis.connect()
        }
        await this.redis.ping()
        console.info('[L1Provider] Redis connection established')
      }
      catch (error) {
        console.error('[L1Provider] Redis connection failed:', error)
        throw error
      }
    }

    if (this.postgres) {
      try {
        await this.createTablesIfNotExists()
        console.info('[L1Provider] Postgres connection established and tables ready')
      }
      catch (error) {
        console.error('[L1Provider] Postgres initialization failed:', error)
        throw error
      }
    }
  }

  async addMessage(message: L1Message): Promise<void> {
    // Add to Redis (cache)
    if (this.redis) {
      const key = this.getSessionKey(message.sessionId)
      const messageJson = JSON.stringify(message)
      await this.redis.lpush(key, messageJson)

      if (this.config.redis?.ttlSeconds) {
        await this.redis.expire(key, this.config.redis.ttlSeconds)
      }

      // Update session metadata
      const metaKey = `${key}:meta`
      await this.redis.hset(metaKey, {
        sessionId: message.sessionId,
        userId: message.userId ?? '',
        lastActivity: message.timestamp.toISOString(),
      })
      if (this.config.redis?.ttlSeconds) {
        await this.redis.expire(metaKey, this.config.redis.ttlSeconds)
      }
    }

    // Persist to Postgres
    if (this.postgres) {
      const tableName = this.config.postgres?.tableName ?? 'l1_messages'
      const query = `
        INSERT INTO ${tableName} 
        (message_id, session_id, user_id, role, content, timestamp, metadata, sequence_number)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `
      const values = [
        message.messageId,
        message.sessionId,
        message.userId ?? null,
        message.role,
        message.content,
        message.timestamp,
        JSON.stringify(message.metadata ?? {}),
        message.sequenceNumber ?? null,
      ]

      await this.postgres.query(query, values)
    }

    // Update cache
    if (this.config.cacheEnabled) {
      this.addToCache(message.sessionId, message)
    }
  }

  async getMessages(sessionId: string, limit?: number, offset?: number): Promise<L1Message[]> {
    const actualLimit = limit ?? 100
    const actualOffset = offset ?? 0

    // Try Redis first
    if (this.redis) {
      const key = this.getSessionKey(sessionId)
      const start = actualOffset
      const end = actualOffset + actualLimit - 1
      const messages = await this.redis.lrange(key, start, end)

      if (messages.length > 0) {
        return messages.map(msg => this.parseMessage(JSON.parse(msg)))
      }
    }

    // Fallback to Postgres
    if (this.postgres) {
      const tableName = this.config.postgres?.tableName ?? 'l1_messages'
      const query = `
        SELECT * FROM ${tableName}
        WHERE session_id = $1
        ORDER BY timestamp DESC
        LIMIT $2 OFFSET $3
      `
      const result = await this.postgres.query(query, [sessionId, actualLimit, actualOffset])
      return result.rows.map(row => this.parseDbRow(row))
    }

    return []
  }

  async getSession(sessionId: string): Promise<L1Session | null> {
    const messages = await this.getMessages(sessionId)

    if (messages.length === 0) {
      return null
    }

    const startTime = messages[messages.length - 1].timestamp
    const lastActivity = messages[0].timestamp
    const userId = messages.find(m => m.userId)?.userId

    return {
      sessionId,
      userId,
      startTime,
      lastActivity,
      messages,
      totalMessages: messages.length,
    }
  }

  async listActiveSessions(userId?: string, hoursBack?: number): Promise<L1Session[]> {
    const hours = hoursBack ?? this.config.sessionDurationHours ?? DEFAULT_SESSION_DURATION_HOURS
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000)

    if (this.postgres) {
      const tableName = this.config.postgres?.tableName ?? 'l1_messages'
      let query = `
        SELECT DISTINCT session_id, user_id, 
               MIN(timestamp) as start_time,
               MAX(timestamp) as last_activity,
               COUNT(*) as total_messages
        FROM ${tableName}
        WHERE timestamp >= $1
      `
      const params: unknown[] = [cutoffTime]

      if (userId) {
        query += ` AND user_id = $2`
        params.push(userId)
      }

      query += ` GROUP BY session_id, user_id ORDER BY last_activity DESC`

      const result = await this.postgres.query(query, params)

      return result.rows.map(row => ({
        sessionId: row.session_id,
        userId: row.user_id,
        startTime: new Date(row.start_time),
        lastActivity: new Date(row.last_activity),
        messages: [],
        totalMessages: Number.parseInt(row.total_messages, 10),
      }))
    }

    return []
  }

  async searchInSession(sessionId: string, query: string, limit?: number): Promise<L1Message[]> {
    const messages = await this.getMessages(sessionId)
    const lowerQuery = query.toLowerCase()

    return messages
      .filter(msg => msg.content.toLowerCase().includes(lowerQuery))
      .slice(0, limit ?? 10)
  }

  async expireSessions(hoursBack: number): Promise<number> {
    if (!this.postgres) {
      return 0
    }

    const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000)
    const tableName = this.config.postgres?.tableName ?? 'l1_messages'

    const result = await this.postgres.query(
      `DELETE FROM ${tableName} WHERE timestamp < $1`,
      [cutoffTime],
    )

    return result.rowCount ?? 0
  }

  async clearSession(sessionId: string): Promise<void> {
    // Clear Redis
    if (this.redis) {
      const key = this.getSessionKey(sessionId)
      const metaKey = `${key}:meta`
      await this.redis.del(key, metaKey)
    }

    // Clear Postgres
    if (this.postgres) {
      const tableName = this.config.postgres?.tableName ?? 'l1_messages'
      await this.postgres.query(`DELETE FROM ${tableName} WHERE session_id = $1`, [sessionId])
    }

    // Clear cache
    this.cache.delete(sessionId)
  }

  private getSessionKey(sessionId: string): string {
    const namespace = this.config.redis?.namespace ?? 'airi:memory:L1'
    return `${namespace}:${sessionId}`
  }

  private createRedisClient(options?: L1Config['redis']): Redis {
    const config: RedisOptions = {
      lazyConnect: true,
      host: options?.host ?? 'localhost',
      port: options?.port ?? 6379,
      password: options?.password,
    }

    return new Redis(config)
  }

  private createPostgresPool(options?: L1Config['postgres']): Pool {
    const config: PoolConfig = options?.connectionString
      ? { connectionString: options.connectionString }
      : {
          host: options?.host ?? 'localhost',
          port: options?.port ?? 5432,
          database: options?.database ?? 'airi',
          user: options?.user,
          password: options?.password,
          ssl: options?.ssl,
        }

    return new PgPool(config)
  }

  private async createTablesIfNotExists(): Promise<void> {
    const tableName = this.config.postgres?.tableName ?? 'l1_messages'

    // Create table without inline indexes (PostgreSQL doesn't support MySQL-style inline INDEX)
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id SERIAL PRIMARY KEY,
        message_id VARCHAR(255) NOT NULL,
        session_id VARCHAR(255) NOT NULL,
        user_id VARCHAR(255),
        role VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        timestamp TIMESTAMP NOT NULL,
        metadata JSONB,
        sequence_number INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `

    await this.postgres!.query(createTableQuery)

    // Create indexes separately
    const indexQueries = [
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_session_id ON ${tableName} (session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_user_id ON ${tableName} (user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_${tableName}_timestamp ON ${tableName} (timestamp)`,
    ]

    for (const indexQuery of indexQueries) {
      try {
        await this.postgres!.query(indexQuery)
      }
      catch (error) {
        console.warn(`[L1Provider] Failed to create index: ${error}`)
      }
    }
  }

  private parseMessage(data: unknown): L1Message {
    const msg = data as L1Message
    return {
      ...msg,
      timestamp: new Date(msg.timestamp),
    }
  }

  private parseDbRow(row: Record<string, unknown>): L1Message {
    return {
      messageId: row.message_id as string,
      sessionId: row.session_id as string,
      userId: row.user_id as string | undefined,
      role: row.role as string,
      content: row.content as string,
      timestamp: new Date(row.timestamp as string),
      metadata: row.metadata as Record<string, unknown> | undefined,
      sequenceNumber: row.sequence_number as number | undefined,
    }
  }

  private addToCache(sessionId: string, message: L1Message): void {
    const cached = this.cache.get(sessionId) ?? []
    cached.unshift(message)

    if (cached.length > this.cacheSize) {
      cached.pop()
    }

    this.cache.set(sessionId, cached)

    // Limit cache size
    if (this.cache.size > 100) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
      }
    }
  }
}

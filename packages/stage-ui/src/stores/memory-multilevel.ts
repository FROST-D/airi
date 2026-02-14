import type {
  L0Config,
  L0Message,
  L0WorkingSet,
  L1Config,
  L1Message,
  L1Session,
  L2Chunk,
  L2Config,
  L3Config,
  L3Document,
  MultilevelMemoryConfig,
  SearchFilters,
  SearchOptions,
} from '@proj-airi/memory-multilevel'

import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

// IPC invokers will be lazily initialized
let memoryIpcInvokers: ReturnType<typeof createMemoryInvokers> | null = null

function createMemoryInvokers() {
  // This will be overridden by Tamagotchi app - for now, return mock
  return {
    initialize: async (_config: any) => ({ success: false, error: 'IPC not configured' }),
    getStatus: async () => ({ initialized: false }),
    l0AddMessage: async (_payload: any) => {},
    l0GetWorkingSet: async (_payload: any) => null,
    l0SetSessionSummary: async (_payload: any) => {},
    l0SetPinnedFact: async (_payload: any) => {},
    l0RemovePinnedFact: async (_payload: any) => {},
    l0ClearMessages: async (_payload: any) => {},
    l0ClearSession: async (_payload: any) => {},
    l1AddMessage: async (_payload: any) => {},
    l1GetSession: async (_payload: any) => null,
    l1ListActiveSessions: async (_payload: any) => [],
    l1SearchInSession: async (_payload: any) => [],
    l1ClearSession: async (_payload: any) => {},
    l1ExpireSessions: async (_payload: any) => 0,
    l2AddChunk: async (_payload: any) => {},
    l2SearchHybrid: async (_payload: any) => [],
    l2ListBySource: async (_payload: any) => [],
    l2DeleteBySource: async (_payload: any) => 0,
    l3AddDocument: async (_payload: any) => {},
    l3SearchHybrid: async (_payload: any) => [],
    l3ListDocuments: async (_payload: any) => [],
    l3GetDocument: async (_payload: any) => null,
    l3DeleteDocument: async (_payload: any) => {},
  }
}

export function setMemoryMultilevelInvokers(invokers: ReturnType<typeof createMemoryInvokers>) {
  memoryIpcInvokers = invokers
}

function getInvokers() {
  if (!memoryIpcInvokers) {
    memoryIpcInvokers = createMemoryInvokers()
  }
  return memoryIpcInvokers
}

/**
 * Store per la gestione della memoria MultiLevel (L0-L3)
 *
 * - L0: Working Set (6-12 messaggi recenti, summary, pinned facts) - Redis + RAM
 * - L1: Episodic Memory (sessioni chat, TTL-based) - Redis + Postgres
 * - L2: Semantic Memory (conversazioni, note, snippets) - Postgres + pgvector
 * - L3: Knowledge Base (documenti con versioning) - Postgres + pgvector
 */
export const useMultilevelMemoryStore = defineStore('memory-multilevel', () => {
  // ===================
  // STATE - Configuration
  // ===================
  const enabled = useLocalStorage('settings/memory-multilevel/enabled', false)

  // L0 Working Set Config
  const l0Enabled = useLocalStorage('settings/memory-multilevel/l0/enabled', true)
  const l0Storage = useLocalStorage<'redis' | 'memory'>('settings/memory-multilevel/l0/storage', 'memory')
  const l0RedisUrl = useLocalStorage('settings/memory-multilevel/l0/redis-url', 'redis://localhost:6379')
  const l0MaxMessages = useLocalStorage('settings/memory-multilevel/l0/max-messages', 10)
  const l0MaxTokens = useLocalStorage('settings/memory-multilevel/l0/max-tokens', 4000)
  const l0KeyPrefix = useLocalStorage('settings/memory-multilevel/l0/key-prefix', 'airi:L0:')

  // L1 Episodic Memory Config
  const l1Enabled = useLocalStorage('settings/memory-multilevel/l1/enabled', true)
  const l1Storage = useLocalStorage<'redis' | 'postgres' | 'both'>('settings/memory-multilevel/l1/storage', 'both')
  const l1RedisUrl = useLocalStorage('settings/memory-multilevel/l1/redis-url', 'redis://localhost:6379')
  const l1PostgresUrl = useLocalStorage('settings/memory-multilevel/l1/postgres-url', '')
  const l1SessionTtl = useLocalStorage('settings/memory-multilevel/l1/session-ttl', 3600 * 24 * 7) // 7 days
  const l1KeyPrefix = useLocalStorage('settings/memory-multilevel/l1/key-prefix', 'airi:L1:')
  const l1TableName = useLocalStorage('settings/memory-multilevel/l1/table-name', 'l1_episodic_memory')

  // L2 Semantic Memory Config
  const l2Enabled = useLocalStorage('settings/memory-multilevel/l2/enabled', false)
  const l2PostgresUrl = useLocalStorage('settings/memory-multilevel/l2/postgres-url', '')
  const l2TableName = useLocalStorage('settings/memory-multilevel/l2/table-name', 'l2_semantic_memory')
  const l2EmbeddingModel = useLocalStorage('settings/memory-multilevel/l2/embedding-model', 'text-embedding-3-small')
  const l2OpenaiApiKey = useLocalStorage('settings/memory-multilevel/l2/openai-api-key', '')
  const l2OpenaiBaseUrl = useLocalStorage('settings/memory-multilevel/l2/openai-base-url', '')
  const l2UseHybridSearch = useLocalStorage('settings/memory-multilevel/l2/use-hybrid-search', true)

  // L3 Knowledge Base Config
  const l3Enabled = useLocalStorage('settings/memory-multilevel/l3/enabled', false)
  const l3PostgresUrl = useLocalStorage('settings/memory-multilevel/l3/postgres-url', '')
  const l3TableName = useLocalStorage('settings/memory-multilevel/l3/table-name', 'l3_knowledge_base')
  const l3EmbeddingModel = useLocalStorage('settings/memory-multilevel/l3/embedding-model', 'text-embedding-3-small')
  const l3OpenaiApiKey = useLocalStorage('settings/memory-multilevel/l3/openai-api-key', '')
  const l3OpenaiBaseUrl = useLocalStorage('settings/memory-multilevel/l3/openai-base-url', '')
  const l3UseHybridSearch = useLocalStorage('settings/memory-multilevel/l3/use-hybrid-search', true)

  // Runtime state
  const initializationError = ref<string | null>(null)
  const initializationLoading = ref(false)
  const initialized = ref(false)

  // ===================
  // GETTERS - Computed Configuration
  // ===================
  const l0Config = computed<L0Config>(() => ({
    enabled: l0Enabled.value,
    storage: l0Storage.value,
    maxMessages: l0MaxMessages.value,
    maxSessionSummaryTokens: l0MaxTokens.value,
    redis: l0Storage.value === 'redis'
      ? {
          host: new URL(l0RedisUrl.value || 'redis://localhost:6379').hostname,
          port: Number(new URL(l0RedisUrl.value || 'redis://localhost:6379').port) || 6379,
          namespace: l0KeyPrefix.value,
        }
      : undefined,
  }))

  const l1Config = computed<L1Config>(() => ({
    enabled: l1Enabled.value,
    storage: l1Storage.value,
    redis: l1Storage.value === 'redis' || l1Storage.value === 'both'
      ? {
          host: new URL(l1RedisUrl.value || 'redis://localhost:6379').hostname,
          port: Number(new URL(l1RedisUrl.value || 'redis://localhost:6379').port) || 6379,
          namespace: l1KeyPrefix.value,
          ttlSeconds: l1SessionTtl.value,
        }
      : undefined,
    postgres: l1Storage.value === 'postgres' || l1Storage.value === 'both'
      ? {
          connectionString: l1PostgresUrl.value,
          tableName: l1TableName.value,
        }
      : undefined,
  }))

  const l2Config = computed<L2Config | undefined>(() => {
    if (!l2Enabled.value || !l2PostgresUrl.value || !l2OpenaiApiKey.value) {
      return undefined
    }
    return {
      enabled: true,
      storage: 'postgres-pgvector' as const,
      hybridSearch: l2UseHybridSearch.value,
      embedding: {
        provider: 'openai' as const,
        apiKey: l2OpenaiApiKey.value,
        model: l2EmbeddingModel.value,
        baseUrl: l2OpenaiBaseUrl.value || undefined,
        dimensions: getEmbeddingDimensions(l2EmbeddingModel.value),
      },
      postgres: {
        connectionString: l2PostgresUrl.value,
        tableName: l2TableName.value,
      },
    }
  })

  const l3Config = computed<L3Config | undefined>(() => {
    if (!l3Enabled.value || !l3PostgresUrl.value || !l3OpenaiApiKey.value) {
      return undefined
    }
    return {
      enabled: true,
      storage: 'postgres-pgvector' as const,
      hybridSearch: l3UseHybridSearch.value,
      versioningEnabled: true,
      embedding: {
        provider: 'openai' as const,
        apiKey: l3OpenaiApiKey.value,
        model: l3EmbeddingModel.value,
        baseUrl: l3OpenaiBaseUrl.value || undefined,
        dimensions: getEmbeddingDimensions(l3EmbeddingModel.value),
      },
      postgres: {
        connectionString: l3PostgresUrl.value,
        tableName: l3TableName.value,
      },
    }
  })

  /**
   * Get embedding dimensions for a given model
   */
  function getEmbeddingDimensions(model: string): number {
    const dimensionMap: Record<string, number> = {
      'nomic-embed-text': 768,
      'text-embedding-3-small': 1536,
      'text-embedding-3-large': 3072,
      'text-embedding-ada-002': 1536,
      'text-embedding-ada-001': 1024,
    }

    return dimensionMap[model] ?? 1536 // default to 1536 if unknown
  }

  const fullConfig = computed<MultilevelMemoryConfig>(() => ({
    L0: l0Config.value,
    L1: l1Config.value,
    L2: l2Config.value,
    L3: l3Config.value,
  }))

  const isConfigured = computed(() => {
    // Almeno L0 e L1 devono essere abilitati
    return l0Enabled.value && l1Enabled.value && !!(l1PostgresUrl.value || l1Storage.value === 'redis')
  })

  // ===================
  // ACTIONS - Initialization
  // ===================
  async function initialize() {
    if (initialized.value) {
      return
    }

    if (!enabled.value || !isConfigured.value) {
      initializationError.value = 'Multilevel memory not configured or disabled'
      return
    }

    initializationLoading.value = true
    initializationError.value = null

    try {
      // Log configuration before initialization
      console.debug('[MemoryMultilevelStore] Configuration:', {
        L0: !!fullConfig.value.L0,
        L1: !!fullConfig.value.L1,
        L2: !!fullConfig.value.L2,
        L3: !!fullConfig.value.L3,
      })

      if (!fullConfig.value.L2) {
        console.warn('[MemoryMultilevelStore] L2 is not configured. Check:', {
          l2Enabled: l2Enabled.value,
          hasPostgresUrl: !!l2PostgresUrl.value,
          hasApiKey: !!l2OpenaiApiKey.value,
        })
      }

      // Chiama il main process per inizializzare il manager
      const invokers = getInvokers()
      const result = await invokers.initialize(fullConfig.value)

      if (!result.success) {
        throw new Error(result.error || 'Failed to initialize memory multilevel')
      }

      initialized.value = true
    }
    catch (error) {
      initializationError.value = error instanceof Error ? error.message : String(error)
      initialized.value = false
      throw error
    }
    finally {
      initializationLoading.value = false
    }
  }

  async function ensureInitialized() {
    const invokers = getInvokers()
    const status = await invokers.getStatus()
    if (!status.initialized) {
      await initialize()
    }
  }

  function reset() {
    initialized.value = false
    initializationError.value = null
  }

  // ===================
  // ACTIONS - L0 Working Set
  // ===================
  async function l0GetWorkingSet(sessionId: string): Promise<L0WorkingSet | null> {
    await ensureInitialized()
    const invokers = getInvokers()
    return await invokers.l0GetWorkingSet({ sessionId })
  }

  async function l0AddMessage(sessionId: string, message: L0Message): Promise<void> {
    await ensureInitialized()
    const invokers = getInvokers()
    await invokers.l0AddMessage({ sessionId, message })
  }

  async function l0SetSessionSummary(sessionId: string, summary: { summary: string, tokenCount: number, lastUpdated: Date }): Promise<void> {
    await ensureInitialized()
    const invokers = getInvokers()
    await invokers.l0SetSessionSummary({ sessionId, summary })
  }

  async function l0SetPinnedFact(sessionId: string, fact: { key: string, value: string, tokenCount: number, priority?: number }): Promise<void> {
    await ensureInitialized()
    const invokers = getInvokers()
    await invokers.l0SetPinnedFact({ sessionId, fact })
  }

  async function l0RemovePinnedFact(sessionId: string, key: string): Promise<void> {
    await ensureInitialized()
    const invokers = getInvokers()
    await invokers.l0RemovePinnedFact({ sessionId, key })
  }

  async function l0ClearMessages(sessionId: string): Promise<void> {
    await ensureInitialized()
    const invokers = getInvokers()
    await invokers.l0ClearMessages({ sessionId })
  }

  async function l0ClearSession(sessionId: string): Promise<void> {
    await ensureInitialized()
    const invokers = getInvokers()
    await invokers.l0ClearSession({ sessionId })
  }

  // Removed duplicate methods - using IPC-based implementations above

  // ===================
  // ACTIONS - L1 Episodic Memory
  // ===================
  async function l1AddMessage(message: L1Message): Promise<void> {
    await ensureInitialized()
    const invokers = getInvokers()
    await invokers.l1AddMessage({ message: { ...message, messageId: message.messageId || crypto.randomUUID() } })
  }

  async function l1GetSession(sessionId: string): Promise<L1Session | null> {
    await ensureInitialized()
    const invokers = getInvokers()
    return await invokers.l1GetSession({ sessionId })
  }

  async function l1ListActiveSessions(userId: string, hours?: number): Promise<L1Session[]> {
    await ensureInitialized()
    const invokers = getInvokers()
    return await invokers.l1ListActiveSessions({ userId, hours })
  }

  async function l1SearchInSession(sessionId: string, query: string, limit?: number): Promise<L1Message[]> {
    await ensureInitialized()
    const invokers = getInvokers()
    return await invokers.l1SearchInSession({ sessionId, query, limit })
  }

  async function l1ClearSession(sessionId: string): Promise<void> {
    await ensureInitialized()
    const invokers = getInvokers()
    await invokers.l1ClearSession({ sessionId })
  }

  async function l1ExpireSessions(hoursBack: number = 24): Promise<number> {
    await ensureInitialized()
    const invokers = getInvokers()
    return await invokers.l1ExpireSessions({ hoursBack })
  }

  // ===================
  // ACTIONS - L2 Semantic Memory
  // ===================
  async function l2AddChunk(chunk: L2Chunk): Promise<void> {
    await ensureInitialized()
    const invokers = getInvokers()
    await invokers.l2AddChunk({ chunk })
  }

  async function l2SearchHybrid(query: string, options?: SearchOptions): Promise<Array<{ chunk: L2Chunk, score?: number }>> {
    await ensureInitialized()
    const invokers = getInvokers()
    return await invokers.l2SearchHybrid({ query, options })
  }

  async function l2ListBySource(sourceType: string, sourceId: string, limit?: number): Promise<L2Chunk[]> {
    await ensureInitialized()
    const invokers = getInvokers()
    return await invokers.l2ListBySource({ sourceType, sourceId, limit })
  }

  async function l2DeleteBySource(sourceType: string, sourceId: string): Promise<number> {
    await ensureInitialized()
    const invokers = getInvokers()
    return await invokers.l2DeleteBySource({ sourceType, sourceId })
  }

  // ===================
  // ACTIONS - L3 Knowledge Base
  // ===================
  async function l3AddDocument(document: L3Document): Promise<void> {
    await ensureInitialized()
    const invokers = getInvokers()
    await invokers.l3AddDocument({ document })
  }

  async function l3SearchHybrid(query: string, options?: SearchOptions): Promise<Array<{ document: L3Document, score?: number }>> {
    await ensureInitialized()
    const invokers = getInvokers()
    return await invokers.l3SearchHybrid({ query, options })
  }

  async function l3ListDocuments(filters?: SearchFilters, limit?: number, offset?: number): Promise<L3Document[]> {
    await ensureInitialized()
    const invokers = getInvokers()
    return await invokers.l3ListDocuments({ filters, limit, offset })
  }

  async function l3GetDocument(documentId: string): Promise<L3Document | null> {
    await ensureInitialized()
    const invokers = getInvokers()
    return await invokers.l3GetDocument({ documentId })
  }

  async function l3DeleteDocument(documentId: string): Promise<void> {
    await ensureInitialized()
    const invokers = getInvokers()
    await invokers.l3DeleteDocument({ documentId })
  }

  // ===================
  // RETURN PUBLIC API
  // ===================
  return {
    // State
    enabled,
    initialized,
    initializationLoading,
    initializationError,
    isConfigured,

    // Configuration
    l0Enabled,
    l0Storage,
    l0RedisUrl,
    l0MaxMessages,
    l0MaxTokens,
    l0KeyPrefix,

    l1Enabled,
    l1Storage,
    l1RedisUrl,
    l1PostgresUrl,
    l1SessionTtl,
    l1KeyPrefix,
    l1TableName,

    l2Enabled,
    l2PostgresUrl,
    l2TableName,
    l2EmbeddingModel,
    l2OpenaiApiKey,
    l2OpenaiBaseUrl,
    l2UseHybridSearch,

    l3Enabled,
    l3PostgresUrl,
    l3TableName,
    l3EmbeddingModel,
    l3OpenaiApiKey,
    l3OpenaiBaseUrl,
    l3UseHybridSearch,

    // Computed configs
    l0Config,
    l1Config,
    l2Config,
    l3Config,
    fullConfig,

    // Initialization
    initialize,
    reset,

    // L0 Actions
    l0GetWorkingSet,
    l0AddMessage,
    l0SetSessionSummary,
    l0SetPinnedFact,
    l0RemovePinnedFact,
    l0ClearMessages,
    l0ClearSession,

    // L1 Actions
    l1AddMessage,
    l1GetSession,
    l1ListActiveSessions,
    l1SearchInSession,
    l1ClearSession,
    l1ExpireSessions,

    // L2 Actions
    l2AddChunk,
    l2SearchHybrid,
    l2ListBySource,
    l2DeleteBySource,

    // L3 Actions
    l3AddDocument,
    l3SearchHybrid,
    l3ListDocuments,
    l3GetDocument,
    l3DeleteDocument,
  }
})

// Export type for external use
export type MultilevelMemoryStore = ReturnType<typeof useMultilevelMemoryStore>

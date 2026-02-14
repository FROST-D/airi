export type MemoryLevel = 'L0' | 'L1' | 'L2' | 'L3'

// L0 — Working set in prompt (super piccolo)
export interface L0Config {
  enabled: boolean
  maxMessages?: number // 6-12 messaggi
  maxSessionSummaryTokens?: number // 150-300 token
  pinnedFactsMaxTokens?: number // per preferenze utente, obiettivo corrente
  storage: 'redis' | 'memory' // Redis per velocità + anche in RAM
  redis?: {
    host?: string
    port?: number
    password?: string
    namespace?: string
  }
}

// L1 — Episodic memory (sessione corrente / ultime ore)
export interface L1Config {
  enabled: boolean
  sessionDurationHours?: number // ultime X ore
  maxMessagesPerSession?: number
  cacheEnabled?: boolean
  cacheSize?: number
  storage: 'redis' | 'postgres' | 'both' // Redis per cache + persist su Postgres
  redis?: {
    host?: string
    port?: number
    password?: string
    namespace?: string
    ttlSeconds?: number // TTL per Redis
  }
  postgres?: {
    connectionString?: string
    host?: string
    port?: number
    database?: string
    user?: string
    password?: string
    ssl?: boolean
    tableName?: string
  }
}

// L2 — Long-term semantic memory (per tenant/workspace)
export interface L2Config {
  enabled: boolean
  chunkSize?: number // dimensione massima dei chunk
  chunkOverlap?: number // overlap tra chunk
  hybridSearch?: boolean // vector + keyword
  storage: 'postgres-pgvector' | 'paradedb' // Postgres + pgvector o ParadeDB
  embedding?: {
    provider: 'openai' | 'openai-compatible' | 'cloudflare'
    apiKey: string
    model: string
    baseUrl?: string
    accountId?: string
    dimensions?: number // embedding dimensions (e.g., 768 for nomic-embed-text, 1536 for text-embedding-3-small)
  }
  postgres?: {
    connectionString?: string
    host?: string
    port?: number
    database?: string
    user?: string
    password?: string
    ssl?: boolean
    tableName?: string
    indexType?: 'ivfflat' | 'hnsw' // tipo di indice per pgvector
  }
  paradedb?: {
    connectionString?: string
    host?: string
    port?: number
    database?: string
    user?: string
    password?: string
    ssl?: boolean
    tableName?: string
  }
}

// L3 — Knowledge base / documents (file, readme, docs, error logs)
export interface L3Config {
  enabled: boolean
  chunkSize?: number
  chunkOverlap?: number
  hybridSearch?: boolean
  versioningEnabled?: boolean
  storage: 'postgres-pgvector' | 'paradedb'
  embedding?: {
    provider: 'openai' | 'openai-compatible' | 'cloudflare'
    apiKey: string
    model: string
    baseUrl?: string
    accountId?: string
    dimensions?: number // embedding dimensions (e.g., 768 for nomic-embed-text, 1536 for text-embedding-3-small)
  }
  postgres?: {
    connectionString?: string
    host?: string
    port?: number
    database?: string
    user?: string
    password?: string
    ssl?: boolean
    tableName?: string
    indexType?: 'ivfflat' | 'hnsw'
  }
  paradedb?: {
    connectionString?: string
    host?: string
    port?: number
    database?: string
    user?: string
    password?: string
    ssl?: boolean
    tableName?: string
  }
  scopeFilters?: {
    repositories?: string[]
    branches?: string[]
    paths?: string[]
    languages?: string[]
    fileTypes?: string[]
  }
}

export interface MultilevelMemoryConfig {
  L0: L0Config
  L1?: L1Config
  L2?: L2Config
  L3?: L3Config
}

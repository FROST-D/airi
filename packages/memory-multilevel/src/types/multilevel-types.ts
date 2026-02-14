export interface BaseMessage {
  role: string
  content: string
  timestamp: Date
  metadata?: Record<string, unknown>
}

export interface L0Message extends BaseMessage {
  messageId?: string
  tokenCount?: number
}

export interface L0SessionSummary {
  summary: string
  tokenCount: number
  lastUpdated: Date
}

export interface L0PinnedFact {
  key: string
  value: string
  tokenCount: number
  priority?: number
}

export interface L0WorkingSet {
  messages: L0Message[]
  sessionSummary?: L0SessionSummary
  pinnedFacts: L0PinnedFact[]
  totalTokens: number
}

export interface L1Message extends BaseMessage {
  messageId: string
  sessionId: string
  userId?: string
  sequenceNumber?: number
}

export interface L1Session {
  sessionId: string
  userId?: string
  startTime: Date
  lastActivity: Date
  messages: L1Message[]
  totalMessages: number
}

export interface L2Chunk {
  chunkId: string
  content: string
  embedding?: number[]
  source: string // 'chat' | 'discord' | 'note' | 'code-snippet'
  sourceId: string
  tenantId: string
  workspaceId?: string
  timestamp: Date
  metadata?: Record<string, unknown>
  keywords?: string[]
}

export interface L2SearchResult {
  chunk: L2Chunk
  similarity: number
  keywordScore?: number
  hybridScore?: number
}

export interface L3Document {
  documentId: string
  filePath: string
  fileName: string
  fileType: string
  language?: string
  repository?: string
  branch?: string
  version?: string
  content: string
  chunks: L3Chunk[]
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

export interface L3Chunk {
  chunkId: string
  documentId: string
  content: string
  embedding?: number[]
  chunkIndex: number
  charStart: number
  charEnd: number
  metadata?: Record<string, unknown>
}

export interface L3SearchResult {
  chunk: L3Chunk
  document: Partial<L3Document>
  similarity: number
  keywordScore?: number
  hybridScore?: number
}

export interface SearchFilters {
  startDate?: Date
  endDate?: Date
  userId?: string
  tenantId?: string
  workspaceId?: string
  sessionId?: string
  source?: string
  repository?: string
  branch?: string
  path?: string
  language?: string
  fileType?: string
}

export interface SearchOptions {
  limit?: number
  offset?: number
  minSimilarity?: number
  useHybrid?: boolean
  filters?: SearchFilters
  includeMetadata?: boolean
}

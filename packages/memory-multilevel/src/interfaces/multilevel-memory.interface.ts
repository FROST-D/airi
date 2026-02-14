import type { L0Message, L0PinnedFact, L0SessionSummary, L0WorkingSet, L1Message, L1Session, L2Chunk, L2SearchResult, L3Document, L3SearchResult, SearchOptions } from '../types/multilevel-types'

// L0 — Working set in prompt
export interface IL0Provider {
  initialize: () => Promise<void>
  addMessage: (sessionId: string, message: L0Message) => Promise<void>
  getMessages: (sessionId: string, limit?: number) => Promise<L0Message[]>
  setSessionSummary: (sessionId: string, summary: L0SessionSummary) => Promise<void>
  getSessionSummary: (sessionId: string) => Promise<L0SessionSummary | null>
  setPinnedFact: (sessionId: string, fact: L0PinnedFact) => Promise<void>
  getPinnedFacts: (sessionId: string) => Promise<L0PinnedFact[]>
  removePinnedFact: (sessionId: string, key: string) => Promise<void>
  getWorkingSet: (sessionId: string) => Promise<L0WorkingSet>
  clearSession: (sessionId: string) => Promise<void>
}

// L1 — Episodic memory (sessione corrente / ultime ore)
export interface IL1Provider {
  initialize: () => Promise<void>
  addMessage: (message: L1Message) => Promise<void>
  getMessages: (sessionId: string, limit?: number, offset?: number) => Promise<L1Message[]>
  getSession: (sessionId: string) => Promise<L1Session | null>
  listActiveSessions: (userId?: string, hoursBack?: number) => Promise<L1Session[]>
  searchInSession: (sessionId: string, query: string, limit?: number) => Promise<L1Message[]>
  expireSessions: (hoursBack: number) => Promise<number>
  clearSession: (sessionId: string) => Promise<void>
}

// L2 — Long-term semantic memory (per tenant/workspace)
export interface IL2Provider {
  initialize: () => Promise<void>
  addChunk: (chunk: L2Chunk) => Promise<void>
  addChunks: (chunks: L2Chunk[]) => Promise<void>
  searchSimilar: (query: string, options?: SearchOptions) => Promise<L2SearchResult[]>
  searchHybrid: (query: string, options?: SearchOptions) => Promise<L2SearchResult[]>
  getChunk: (chunkId: string) => Promise<L2Chunk | null>
  deleteChunk: (chunkId: string) => Promise<void>
  deleteBySource: (source: string, sourceId: string) => Promise<number>
  clearWorkspace: (tenantId: string, workspaceId?: string) => Promise<void>
}

// L3 — Knowledge base / documents
export interface IL3Provider {
  initialize: () => Promise<void>
  addDocument: (document: L3Document) => Promise<void>
  updateDocument: (documentId: string, document: Partial<L3Document>) => Promise<void>
  getDocument: (documentId: string) => Promise<L3Document | null>
  getDocumentByPath: (filePath: string, repository?: string, branch?: string) => Promise<L3Document | null>
  searchSimilar: (query: string, options?: SearchOptions) => Promise<L3SearchResult[]>
  searchHybrid: (query: string, options?: SearchOptions) => Promise<L3SearchResult[]>
  listDocuments: (filters?: SearchOptions['filters'], limit?: number, offset?: number) => Promise<L3Document[]>
  deleteDocument: (documentId: string) => Promise<void>
  deleteByRepository: (repository: string, branch?: string) => Promise<number>
  clearAll: () => Promise<void>
}

// Combined multilevel interface
export interface IMultilevelMemoryProvider {
  L0: IL0Provider
  L1?: IL1Provider
  L2?: IL2Provider
  L3?: IL3Provider
  initialize: () => Promise<void>
}

import type { MultilevelMemoryManager } from '../multilevel-memory-manager'
import type { SearchOptions } from '../types/multilevel-types'

/**
 * MCP Tools for multilevel memory search
 *
 * These tools allow AI models to search across different memory levels:
 * - L0: Working set (current conversation context)
 * - L1: Episodic memory (recent sessions)
 * - L2: Long-term semantic memory (indexed conversations and notes)
 * - L3: Knowledge base (documents and code)
 */

export interface MCPSearchL0Request {
  sessionId: string
  includeMessages?: boolean
  includeSummary?: boolean
  includePinnedFacts?: boolean
}

export interface MCPSearchL0Response {
  messages?: Array<{
    role: string
    content: string
    timestamp: string
    tokenCount?: number
  }>
  sessionSummary?: {
    summary: string
    tokenCount: number
    lastUpdated: string
  }
  pinnedFacts?: Array<{
    key: string
    value: string
    tokenCount: number
    priority?: number
  }>
  totalTokens: number
}

export interface MCPSearchL1Request {
  sessionId?: string
  userId?: string
  query?: string
  hoursBack?: number
  limit?: number
  offset?: number
}

export interface MCPSearchL1Response {
  sessions?: Array<{
    sessionId: string
    userId?: string
    startTime: string
    lastActivity: string
    totalMessages: number
  }>
  messages?: Array<{
    messageId: string
    sessionId: string
    userId?: string
    role: string
    content: string
    timestamp: string
    sequenceNumber?: number
  }>
}

export interface MCPSearchL2Request {
  query: string
  tenantId: string
  workspaceId?: string
  source?: string
  useHybrid?: boolean
  limit?: number
  minSimilarity?: number
  startDate?: string
  endDate?: string
}

export interface MCPSearchL2Response {
  results: Array<{
    chunkId: string
    content: string
    source: string
    sourceId: string
    tenantId: string
    workspaceId?: string
    timestamp: string
    similarity: number
    keywordScore?: number
    hybridScore?: number
    metadata?: Record<string, unknown>
  }>
  totalResults: number
}

export interface MCPSearchL3Request {
  query: string
  repository?: string
  branch?: string
  path?: string
  language?: string
  fileType?: string
  useHybrid?: boolean
  limit?: number
  minSimilarity?: number
}

export interface MCPSearchL3Response {
  results: Array<{
    chunkId: string
    content: string
    document: {
      documentId: string
      filePath: string
      fileName: string
      fileType: string
      language?: string
      repository?: string
      branch?: string
      version?: string
    }
    chunkIndex: number
    charStart: number
    charEnd: number
    similarity: number
    keywordScore?: number
    hybridScore?: number
  }>
  totalResults: number
}

export interface MCPListL3DocumentsRequest {
  repository?: string
  branch?: string
  path?: string
  language?: string
  fileType?: string
  limit?: number
  offset?: number
}

export interface MCPListL3DocumentsResponse {
  documents: Array<{
    documentId: string
    filePath: string
    fileName: string
    fileType: string
    language?: string
    repository?: string
    branch?: string
    version?: string
    createdAt: string
    updatedAt: string
  }>
  totalDocuments: number
}

/**
 * MCP Tool: memory_search_L0
 *
 * Retrieve the current working set for a session, including recent messages,
 * session summary, and pinned facts.
 */
export async function mcpSearchL0(
  memoryManager: MultilevelMemoryManager,
  request: MCPSearchL0Request,
): Promise<MCPSearchL0Response> {
  const workingSet = await memoryManager.L0.getWorkingSet(request.sessionId)

  return {
    messages: request.includeMessages !== false
      ? workingSet.messages.map(msg => ({
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp.toISOString(),
          tokenCount: msg.tokenCount,
        }))
      : undefined,
    sessionSummary: request.includeSummary !== false && workingSet.sessionSummary
      ? {
          summary: workingSet.sessionSummary.summary,
          tokenCount: workingSet.sessionSummary.tokenCount,
          lastUpdated: workingSet.sessionSummary.lastUpdated.toISOString(),
        }
      : undefined,
    pinnedFacts: request.includePinnedFacts !== false
      ? workingSet.pinnedFacts.map(fact => ({
          key: fact.key,
          value: fact.value,
          tokenCount: fact.tokenCount,
          priority: fact.priority,
        }))
      : undefined,
    totalTokens: workingSet.totalTokens,
  }
}

/**
 * MCP Tool: memory_search_L1
 *
 * Search episodic memory for recent sessions and messages.
 */
export async function mcpSearchL1(
  memoryManager: MultilevelMemoryManager,
  request: MCPSearchL1Request,
): Promise<MCPSearchL1Response> {
  if (!memoryManager.L1) {
    throw new Error('L1 (episodic memory) is not enabled')
  }

  // If searching within a specific session
  if (request.sessionId) {
    if (request.query) {
      // Search for messages matching query in session
      const messages = await memoryManager.L1.searchInSession(
        request.sessionId,
        request.query,
        request.limit,
      )

      return {
        messages: messages.map(msg => ({
          messageId: msg.messageId,
          sessionId: msg.sessionId,
          userId: msg.userId,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp.toISOString(),
          sequenceNumber: msg.sequenceNumber,
        })),
      }
    }
    else {
      // Get all messages from session
      const messages = await memoryManager.L1.getMessages(
        request.sessionId,
        request.limit,
        request.offset,
      )

      return {
        messages: messages.map(msg => ({
          messageId: msg.messageId,
          sessionId: msg.sessionId,
          userId: msg.userId,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp.toISOString(),
          sequenceNumber: msg.sequenceNumber,
        })),
      }
    }
  }

  // List active sessions
  const sessions = await memoryManager.L1.listActiveSessions(
    request.userId,
    request.hoursBack,
  )

  return {
    sessions: sessions.map(session => ({
      sessionId: session.sessionId,
      userId: session.userId,
      startTime: session.startTime.toISOString(),
      lastActivity: session.lastActivity.toISOString(),
      totalMessages: session.totalMessages,
    })),
  }
}

/**
 * MCP Tool: memory_search_L2
 *
 * Search long-term semantic memory for conversation chunks, notes, and snippets.
 */
export async function mcpSearchL2(
  memoryManager: MultilevelMemoryManager,
  request: MCPSearchL2Request,
): Promise<MCPSearchL2Response> {
  if (!memoryManager.L2) {
    throw new Error('L2 (semantic memory) is not enabled')
  }

  const options: SearchOptions = {
    limit: request.limit,
    minSimilarity: request.minSimilarity,
    useHybrid: request.useHybrid,
    filters: {
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      source: request.source,
      startDate: request.startDate ? new Date(request.startDate) : undefined,
      endDate: request.endDate ? new Date(request.endDate) : undefined,
    },
  }

  const results = request.useHybrid
    ? await memoryManager.L2.searchHybrid(request.query, options)
    : await memoryManager.L2.searchSimilar(request.query, options)

  return {
    results: results.map(result => ({
      chunkId: result.chunk.chunkId,
      content: result.chunk.content,
      source: result.chunk.source,
      sourceId: result.chunk.sourceId,
      tenantId: result.chunk.tenantId,
      workspaceId: result.chunk.workspaceId,
      timestamp: result.chunk.timestamp.toISOString(),
      similarity: result.similarity,
      keywordScore: result.keywordScore,
      hybridScore: result.hybridScore,
      metadata: result.chunk.metadata,
    })),
    totalResults: results.length,
  }
}

/**
 * MCP Tool: memory_search_L3
 *
 * Search knowledge base for documents and code chunks.
 */
export async function mcpSearchL3(
  memoryManager: MultilevelMemoryManager,
  request: MCPSearchL3Request,
): Promise<MCPSearchL3Response> {
  if (!memoryManager.L3) {
    throw new Error('L3 (knowledge base) is not enabled')
  }

  const options: SearchOptions = {
    limit: request.limit,
    minSimilarity: request.minSimilarity,
    useHybrid: request.useHybrid,
    filters: {
      repository: request.repository,
      branch: request.branch,
      path: request.path,
      language: request.language,
      fileType: request.fileType,
    },
  }

  const results = request.useHybrid
    ? await memoryManager.L3.searchHybrid(request.query, options)
    : await memoryManager.L3.searchSimilar(request.query, options)

  return {
    results: results.map(result => ({
      chunkId: result.chunk.chunkId,
      content: result.chunk.content,
      document: {
        documentId: result.document.documentId ?? '',
        filePath: result.document.filePath ?? '',
        fileName: result.document.fileName ?? '',
        fileType: result.document.fileType ?? '',
        language: result.document.language,
        repository: result.document.repository,
        branch: result.document.branch,
        version: result.document.version,
      },
      chunkIndex: result.chunk.chunkIndex,
      charStart: result.chunk.charStart,
      charEnd: result.chunk.charEnd,
      similarity: result.similarity,
      keywordScore: result.keywordScore,
      hybridScore: result.hybridScore,
    })),
    totalResults: results.length,
  }
}

/**
 * MCP Tool: memory_list_L3_documents
 *
 * List documents in the knowledge base with optional filters.
 */
export async function mcpListL3Documents(
  memoryManager: MultilevelMemoryManager,
  request: MCPListL3DocumentsRequest,
): Promise<MCPListL3DocumentsResponse> {
  if (!memoryManager.L3) {
    throw new Error('L3 (knowledge base) is not enabled')
  }

  const filters = {
    repository: request.repository,
    branch: request.branch,
    path: request.path,
    language: request.language,
    fileType: request.fileType,
  }

  const documents = await memoryManager.L3.listDocuments(
    filters,
    request.limit,
    request.offset,
  )

  return {
    documents: documents.map(doc => ({
      documentId: doc.documentId,
      filePath: doc.filePath,
      fileName: doc.fileName,
      fileType: doc.fileType,
      language: doc.language,
      repository: doc.repository,
      branch: doc.branch,
      version: doc.version,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    })),
    totalDocuments: documents.length,
  }
}

/**
 * MCP Tool Definitions for registration
 *
 * These can be used to register the tools with an MCP server.
 */
export const mcpToolDefinitions = [
  {
    name: 'memory_search_L0',
    description: 'Retrieve the current working set (recent messages, session summary, pinned facts) for a conversation session',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'The session ID to retrieve working set for',
        },
        includeMessages: {
          type: 'boolean',
          description: 'Include recent messages (default: true)',
        },
        includeSummary: {
          type: 'boolean',
          description: 'Include session summary (default: true)',
        },
        includePinnedFacts: {
          type: 'boolean',
          description: 'Include pinned facts (default: true)',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'memory_search_L1',
    description: 'Search episodic memory for recent sessions and messages from the last few hours',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'Search within a specific session',
        },
        userId: {
          type: 'string',
          description: 'Filter by user ID',
        },
        query: {
          type: 'string',
          description: 'Search query to match against message content',
        },
        hoursBack: {
          type: 'number',
          description: 'How many hours back to search (default: 24)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 100)',
        },
        offset: {
          type: 'number',
          description: 'Offset for pagination (default: 0)',
        },
      },
      required: [],
    },
  },
  {
    name: 'memory_search_L2',
    description: 'Search long-term semantic memory for conversation chunks, Discord messages, notes, and code snippets using vector and/or keyword search',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query',
        },
        tenantId: {
          type: 'string',
          description: 'Tenant ID to scope the search',
        },
        workspaceId: {
          type: 'string',
          description: 'Optional workspace ID to further scope the search',
        },
        source: {
          type: 'string',
          description: 'Filter by source type (e.g., "chat", "discord", "note", "code-snippet")',
        },
        useHybrid: {
          type: 'boolean',
          description: 'Use hybrid search (vector + keyword) for better results (default: true)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 10)',
        },
        minSimilarity: {
          type: 'number',
          description: 'Minimum similarity score (0-1) (default: 0.5)',
        },
        startDate: {
          type: 'string',
          description: 'Filter results after this date (ISO 8601 format)',
        },
        endDate: {
          type: 'string',
          description: 'Filter results before this date (ISO 8601 format)',
        },
      },
      required: ['query', 'tenantId'],
    },
  },
  {
    name: 'memory_search_L3',
    description: 'Search knowledge base for documents, README files, documentation, and code files using vector and/or keyword search',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query',
        },
        repository: {
          type: 'string',
          description: 'Filter by repository name',
        },
        branch: {
          type: 'string',
          description: 'Filter by branch name',
        },
        path: {
          type: 'string',
          description: 'Filter by file path (partial match)',
        },
        language: {
          type: 'string',
          description: 'Filter by programming language',
        },
        fileType: {
          type: 'string',
          description: 'Filter by file type/extension',
        },
        useHybrid: {
          type: 'boolean',
          description: 'Use hybrid search (vector + keyword) for better results (default: true)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 10)',
        },
        minSimilarity: {
          type: 'number',
          description: 'Minimum similarity score (0-1) (default: 0.5)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_list_L3_documents',
    description: 'List documents in the knowledge base with optional filters (useful for browsing available documents)',
    inputSchema: {
      type: 'object',
      properties: {
        repository: {
          type: 'string',
          description: 'Filter by repository name',
        },
        branch: {
          type: 'string',
          description: 'Filter by branch name',
        },
        path: {
          type: 'string',
          description: 'Filter by file path (partial match)',
        },
        language: {
          type: 'string',
          description: 'Filter by programming language',
        },
        fileType: {
          type: 'string',
          description: 'Filter by file type/extension',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of documents to return (default: 100)',
        },
        offset: {
          type: 'number',
          description: 'Offset for pagination (default: 0)',
        },
      },
      required: [],
    },
  },
] as const

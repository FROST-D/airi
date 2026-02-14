import type { MultilevelMemoryConfig } from '../types/multilevel-config'

import { createMultilevelMemory } from '../multilevel-memory-manager'
import { mcpListL3Documents, mcpSearchL0, mcpSearchL1, mcpSearchL2, mcpSearchL3, mcpToolDefinitions } from './mcp-tools'

/**
 * Example MCP Server Integration
 *
 * This file demonstrates how to integrate the multilevel memory system with an MCP server.
 */

export async function setupMemoryMCPServer() {
  // Configuration example
  const config: MultilevelMemoryConfig = {
    L0: {
      enabled: true,
      maxMessages: 12,
      maxSessionSummaryTokens: 300,
      pinnedFactsMaxTokens: 200,
      storage: 'redis',
      redis: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number.parseInt(process.env.REDIS_PORT ?? '6379', 10),
        password: process.env.REDIS_PASSWORD,
        namespace: 'airi:memory:L0',
      },
    },
    L1: {
      enabled: true,
      sessionDurationHours: 24,
      maxMessagesPerSession: 1000,
      cacheEnabled: true,
      storage: 'both',
      redis: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number.parseInt(process.env.REDIS_PORT ?? '6379', 10),
        password: process.env.REDIS_PASSWORD,
        namespace: 'airi:memory:L1',
        ttlSeconds: 86400, // 24 hours
      },
      postgres: {
        connectionString: process.env.POSTGRES_URL,
        tableName: 'l1_messages',
      },
    },
    L2: {
      enabled: true,
      chunkSize: 1000,
      chunkOverlap: 200,
      hybridSearch: true,
      storage: 'postgres-pgvector',
      embedding: {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY ?? '',
        model: 'text-embedding-3-small',
      },
      postgres: {
        connectionString: process.env.POSTGRES_URL,
        tableName: 'l2_chunks',
        indexType: 'hnsw',
      },
    },
    L3: {
      enabled: true,
      chunkSize: 2000,
      chunkOverlap: 400,
      hybridSearch: true,
      versioningEnabled: true,
      storage: 'postgres-pgvector',
      embedding: {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY ?? '',
        model: 'text-embedding-3-small',
      },
      postgres: {
        connectionString: process.env.POSTGRES_URL,
        tableName: 'l3_documents',
        indexType: 'hnsw',
      },
    },
  }

  // Create memory manager
  const memoryManager = createMultilevelMemory(config)
  await memoryManager.initialize()

  // MCP Tool handlers
  const toolHandlers = {
    memory_search_L0: async (args: unknown) => {
      return mcpSearchL0(memoryManager, args as Parameters<typeof mcpSearchL0>[1])
    },
    memory_search_L1: async (args: unknown) => {
      return mcpSearchL1(memoryManager, args as Parameters<typeof mcpSearchL1>[1])
    },
    memory_search_L2: async (args: unknown) => {
      return mcpSearchL2(memoryManager, args as Parameters<typeof mcpSearchL2>[1])
    },
    memory_search_L3: async (args: unknown) => {
      return mcpSearchL3(memoryManager, args as Parameters<typeof mcpSearchL3>[1])
    },
    memory_list_L3_documents: async (args: unknown) => {
      return mcpListL3Documents(memoryManager, args as Parameters<typeof mcpListL3Documents>[1])
    },
  }

  return {
    memoryManager,
    toolHandlers,
    toolDefinitions: mcpToolDefinitions,
  }
}

/**
 * Example usage with MCP server
 */
export async function exampleUsage() {
  const { toolHandlers } = await setupMemoryMCPServer()

  // Example 1: Search working set (L0)
  const workingSet = await toolHandlers.memory_search_L0({
    sessionId: 'session-123',
    includeMessages: true,
    includeSummary: true,
    includePinnedFacts: true,
  })
  console.log('Working set:', workingSet)

  // Example 2: Search episodic memory (L1)
  const recentSessions = await toolHandlers.memory_search_L1({
    userId: 'user-456',
    hoursBack: 12,
  })
  console.log('Recent sessions:', recentSessions)

  // Example 3: Search semantic memory (L2)
  const semanticResults = await toolHandlers.memory_search_L2({
    query: 'How do I configure Redis?',
    tenantId: 'tenant-789',
    useHybrid: true,
    limit: 5,
  })
  console.log('Semantic search results:', semanticResults)

  // Example 4: Search knowledge base (L3)
  const kbResults = await toolHandlers.memory_search_L3({
    query: 'authentication implementation',
    repository: 'airi',
    fileType: 'ts',
    useHybrid: true,
    limit: 10,
  })
  console.log('Knowledge base results:', kbResults)

  // Example 5: List documents in knowledge base
  const documents = await toolHandlers.memory_list_L3_documents({
    repository: 'airi',
    branch: 'main',
    fileType: 'md',
    limit: 20,
  })
  console.log('Documents:', documents)
}

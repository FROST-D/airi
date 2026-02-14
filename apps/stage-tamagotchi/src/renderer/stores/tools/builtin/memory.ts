import type { Tool } from '@xsai/shared-chat'

import { useMultilevelMemoryStore } from '@proj-airi/stage-ui/stores/memory-multilevel'
import { tool } from '@xsai/tool'
import { z } from 'zod'

// Global session ID for cross-session memory queries
const GLOBAL_MEMORY_SESSION_ID = 'global-memory-session'

/**
 * Memory tool actions for LLM to explicitly query memory system
 */

// Search L1 episodic memory (recent sessions)
async function searchRecentMemory(params: { query: string, limit?: number }) {
  const memoryStore = useMultilevelMemoryStore()

  if (!memoryStore.initialized) {
    return 'Memory system not initialized. Please initialize the memory system first.'
  }

  try {
    console.debug('[MemoryTools] Searching L1 globally with query:', params.query)

    const results = await memoryStore.l1SearchInSession(
      GLOBAL_MEMORY_SESSION_ID,
      params.query,
      params.limit ?? 5,
    )

    if (!results || results.length === 0) {
      return `No recent memories found for query: "${params.query}"`
    }

    const formatted = results
      .map((msg, idx) => {
        const role = msg.role || 'unknown'
        const content = msg.content?.substring(0, 200) || 'No content'
        const timestamp = msg.timestamp ? new Date(msg.timestamp).toISOString() : 'unknown time'
        return `${idx + 1}. [${timestamp}] ${role}: ${content}`
      })
      .join('\n\n')

    return `Found ${results.length} recent memories:\n\n${formatted}`
  }
  catch (error) {
    return `Error searching recent memory: ${error instanceof Error ? error.message : String(error)}`
  }
}

// Search L2 semantic memory (past conversations)
async function searchSemanticMemory(params: { query: string, limit?: number }) {
  const memoryStore = useMultilevelMemoryStore()

  if (!memoryStore.initialized) {
    return 'Memory system not initialized. Please initialize the memory system first.'
  }

  if (!memoryStore.l2Enabled) {
    return 'L2 semantic memory is not enabled. Enable it in Settings → Modules → Multilevel Memory.'
  }

  try {
    const results = await memoryStore.l2SearchHybrid(
      params.query,
      { limit: params.limit ?? 5 },
    )

    if (!results || results.length === 0) {
      return `No semantic memories found for query: "${params.query}"`
    }

    const formatted = results
      .map((result, idx) => {
        const content = result.chunk?.content?.substring(0, 250) || 'No content'
        const score = result.score ? `(score: ${result.score.toFixed(2)})` : ''
        const source = result.chunk?.source || 'unknown'
        return `${idx + 1}. ${score} [${source}]: ${content}`
      })
      .join('\n\n')

    return `Found ${results.length} semantic memories:\n\n${formatted}`
  }
  catch (error) {
    return `Error searching semantic memory: ${error instanceof Error ? error.message : String(error)}`
  }
}

// Get L0 working set (current session context)
async function getWorkingSet() {
  const memoryStore = useMultilevelMemoryStore()

  if (!memoryStore.initialized) {
    return 'Memory system not initialized. Please initialize the memory system first.'
  }

  try {
    const workingSet = await memoryStore.l0GetWorkingSet(GLOBAL_MEMORY_SESSION_ID)

    if (!workingSet || !workingSet.messages || workingSet.messages.length === 0) {
      return 'No messages in global working set.'
    }

    const messages = workingSet.messages
      .map((msg, idx) => {
        const role = msg.role || 'unknown'
        const content = msg.content?.substring(0, 150) || 'No content'
        return `${idx + 1}. ${role}: ${content}`
      })
      .join('\n\n')

    const summary = workingSet.sessionSummary
      ? `\n\nSession Summary: ${workingSet.sessionSummary}`
      : ''

    const facts = workingSet.pinnedFacts && Object.keys(workingSet.pinnedFacts).length > 0
      ? `\n\nPinned Facts:\n${Object.entries(workingSet.pinnedFacts).map(([key, val]) => `- ${key}: ${val}`).join('\n')}`
      : ''

    return `Working Set (${workingSet.messages.length} messages):\n\n${messages}${summary}${facts}`
  }
  catch (error) {
    return `Error retrieving working set: ${error instanceof Error ? error.message : String(error)}`
  }
}

// Search L3 knowledge base
async function searchKnowledge(params: { query: string, limit?: number }) {
  const memoryStore = useMultilevelMemoryStore()

  if (!memoryStore.initialized) {
    return 'Memory system not initialized. Please initialize the memory system first.'
  }

  if (!memoryStore.l3Enabled) {
    return 'L3 knowledge base is not enabled. Enable it in Settings → Modules → Multilevel Memory.'
  }

  try {
    const results = await memoryStore.l3SearchHybrid(
      params.query,
      { limit: params.limit ?? 3 },
    )

    if (!results || results.length === 0) {
      return `No knowledge base results found for query: "${params.query}"`
    }

    const formatted = results
      .map((result, idx) => {
        const doc = result.document
        const content = doc?.content?.substring(0, 300) || 'No content'
        const score = result.score ? `(score: ${result.score.toFixed(2)})` : ''
        const path = doc?.filePath || doc?.fileName || 'untitled'
        return `${idx + 1}. ${score} [${path}]\n${content}`
      })
      .join('\n\n')

    return `Found ${results.length} knowledge documents:\n\n${formatted}`
  }
  catch (error) {
    return `Error searching knowledge base: ${error instanceof Error ? error.message : String(error)}`
  }
}

// Define tool schemas
const searchRecentMemorySchema = z.object({
  query: z.string().describe('Search query to find in recent conversation history'),
  limit: z.number().int().min(1).max(20).optional().describe('Maximum number of results (default: 5)'),
}).strict()

const searchSemanticMemorySchema = z.object({
  query: z.string().describe('Semantic search query to find similar past conversations'),
  limit: z.number().int().min(1).max(20).optional().describe('Maximum number of results (default: 5)'),
}).strict()

const getWorkingSetSchema = z.object({}).strict()

const searchKnowledgeSchema = z.object({
  query: z.string().describe('Search query to find in knowledge base documents'),
  limit: z.number().int().min(1).max(10).optional().describe('Maximum number of results (default: 3)'),
}).strict()

// Define tools
const tools: Promise<Tool>[] = [
  tool({
    name: 'memory_search_recent',
    description: 'Search all conversation history (L1 episodic memory) across all sessions for specific information. Use when: (1) User asks "what did I/you say about X?", (2) User references something mentioned in any previous conversation, (3) You need to recall exact quotes or specific details from any session. Searches by keywords in chronological order globally.',
    execute: async (params) => {
      return await searchRecentMemory(params as z.infer<typeof searchRecentMemorySchema>)
    },
    parameters: searchRecentMemorySchema,
  }),

  tool({
    name: 'memory_search_semantic',
    description: 'Search past conversations using semantic similarity (L2 memory). Use when: (1) User asks about topics discussed in previous sessions, (2) You need context about past interactions, (3) Looking for related discussions even if keywords differ. Returns semantically similar conversation chunks with relevance scores.',
    execute: async (params) => {
      return await searchSemanticMemory(params as z.infer<typeof searchSemanticMemorySchema>)
    },
    parameters: searchSemanticMemorySchema,
  }),

  tool({
    name: 'memory_get_working_set',
    description: 'Get global working set (L0 memory) including recent messages, session summary, and pinned facts across all sessions. Use when: (1) You need to review what\'s in your immediate context, (2) Conversation feels confusing and you need to re-orient, (3) User asks "what are we talking about?". Shows the active conversation state.',
    execute: async () => {
      return await getWorkingSet()
    },
    parameters: getWorkingSetSchema,
  }),

  tool({
    name: 'memory_search_knowledge',
    description: 'Search the knowledge base (L3) for documents and long-term information. Use when: (1) User asks about documentation, code, or reference materials, (2) You need to look up facts from stored documents, (3) Technical questions that might be answered by project files. Returns document excerpts with file paths.',
    execute: async (params) => {
      return await searchKnowledge(params as z.infer<typeof searchKnowledgeSchema>)
    },
    parameters: searchKnowledgeSchema,
  }),
]

export const memoryTools = async () => Promise.all(tools)

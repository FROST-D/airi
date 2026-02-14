# @proj-airi/memory-multilevel

Advanced multilevel memory system for AIRI with L0 (working set), L1 (episodic), L2 (semantic), and L3 (knowledge base) support, featuring hybrid search and MCP integration.

## Architecture

The memory system is organized into 4 levels:

### L0 — Working Set in Prompt (Super Small)
- **Purpose**: Current conversation context for the AI model
- **Contains**:
  - Last 6–12 messages
  - Session summary (max 150–300 tokens)
  - Pinned facts (user preferences, current objectives)
- **Storage**: Redis for speed + in-memory RAM
- **Access Pattern**: Ultra-fast, always loaded

### L1 — Episodic Memory (Current Session / Last Few Hours)
- **Purpose**: Recent conversation history and session data
- **Contains**: All messages and records from the current session
- **Storage**: Redis (cache for last X hours) + PostgreSQL (persistence)
- **Access Pattern**: Fast retrieval with caching

### L2 — Long-term Semantic Memory (Per Tenant/Workspace)
- **Purpose**: Indexed conversation chunks, Discord messages, notes, code snippets
- **Contains**: Embedded chunks with metadata
- **Storage**: PostgreSQL + pgvector (or ParadeDB for better hybrid search)
- **Search**: Hybrid (vector + keyword) search
- **Access Pattern**: Semantic similarity search

### L3 — Knowledge Base / Documents
- **Purpose**: Files, README, docs, error logs, code repositories
- **Contains**: Documents with chunking, versioning, and scope filters
- **Storage**: PostgreSQL + pgvector (or ParadeDB)
- **Search**: Hybrid (vector + keyword) with scope filters (repo, branch, path, language)
- **Access Pattern**: Semantic search with rich metadata filtering

## Installation

```bash
pnpm add @proj-airi/memory-multilevel
```

## Basic Usage

```typescript
import { createMultilevelMemory } from '@proj-airi/memory-multilevel'

const memoryManager = createMultilevelMemory({
  L0: {
    enabled: true,
    maxMessages: 12,
    storage: 'redis',
    redis: {
      host: 'localhost',
      port: 6379,
    },
  },
  L1: {
    enabled: true,
    sessionDurationHours: 24,
    storage: 'both',
    redis: { host: 'localhost', port: 6379 },
    postgres: { connectionString: process.env.POSTGRES_URL },
  },
  L2: {
    enabled: true,
    hybridSearch: true,
    storage: 'postgres-pgvector',
    embedding: {
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      model: 'text-embedding-3-small',
    },
    postgres: { connectionString: process.env.POSTGRES_URL },
  },
  L3: {
    enabled: true,
    hybridSearch: true,
    storage: 'postgres-pgvector',
    embedding: {
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      model: 'text-embedding-3-small',
    },
    postgres: { connectionString: process.env.POSTGRES_URL },
  },
})

await memoryManager.initialize()
```

## Working with Each Level

### L0 - Working Set

```typescript
// Add a message to working set
await memoryManager.L0.addMessage('session-123', {
  role: 'user',
  content: 'What is the meaning of life?',
  timestamp: new Date(),
  tokenCount: 8,
})

// Set session summary
await memoryManager.L0.setSessionSummary('session-123', {
  summary: 'User asking philosophical questions about existence.',
  tokenCount: 150,
  lastUpdated: new Date(),
})

// Add pinned fact
await memoryManager.L0.setPinnedFact('session-123', {
  key: 'user_preference_language',
  value: 'Italian',
  tokenCount: 10,
  priority: 1,
})

// Get complete working set
const workingSet = await memoryManager.L0.getWorkingSet('session-123')
console.log(`Total tokens: ${workingSet.totalTokens}`)
```

### L1 - Episodic Memory

```typescript
// Add message to episodic memory
await memoryManager.L1?.addMessage({
  messageId: 'msg-456',
  sessionId: 'session-123',
  userId: 'user-789',
  role: 'assistant',
  content: 'The meaning of life is subjective...',
  timestamp: new Date(),
})

// List recent sessions
const sessions = await memoryManager.L1?.listActiveSessions('user-789', 12)

// Search within a session
const results = await memoryManager.L1?.searchInSession(
  'session-123',
  'meaning of life',
  5
)
```

### L2 - Semantic Memory

```typescript
// Add chunk to semantic memory
await memoryManager.L2?.addChunk({
  chunkId: 'chunk-123',
  content: 'Discussion about Redis configuration...',
  source: 'chat',
  sourceId: 'session-123',
  tenantId: 'tenant-456',
  workspaceId: 'workspace-789',
  timestamp: new Date(),
  keywords: ['redis', 'configuration', 'cache'],
})

// Hybrid search
const results = await memoryManager.L2?.searchHybrid(
  'How to configure Redis?',
  {
    limit: 10,
    minSimilarity: 0.5,
    filters: {
      tenantId: 'tenant-456',
      source: 'chat',
    },
  }
)
```

### L3 - Knowledge Base

```typescript
// Add document to knowledge base
await memoryManager.L3?.addDocument({
  documentId: 'doc-123',
  filePath: 'packages/memory-multilevel/README.md',
  fileName: 'README.md',
  fileType: 'md',
  language: 'markdown',
  repository: 'airi',
  branch: 'main',
  version: 'v1.0.0',
  content: '# Memory Multilevel...',
  chunks: [
    {
      chunkId: 'chunk-doc-123-0',
      documentId: 'doc-123',
      content: '# Memory Multilevel\n\nAdvanced...',
      chunkIndex: 0,
      charStart: 0,
      charEnd: 500,
    },
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
})

// Hybrid search with filters
const results = await memoryManager.L3?.searchHybrid(
  'authentication implementation',
  {
    limit: 10,
    filters: {
      repository: 'airi',
      branch: 'main',
      fileType: 'ts',
      language: 'typescript',
    },
  }
)

// List documents
const documents = await memoryManager.L3?.listDocuments(
  { repository: 'airi', fileType: 'md' },
  50,
  0
)
```

## MCP Integration

The package includes MCP (Model Context Protocol) tools for AI models to search memory:

```typescript
import { setupMemoryMCPServer } from '@proj-airi/memory-multilevel'

const { memoryManager, toolHandlers, toolDefinitions } = await setupMemoryMCPServer()

// Register tools with your MCP server
for (const toolDef of toolDefinitions) {
  mcpServer.registerTool(toolDef, toolHandlers[toolDef.name])
}
```

### Available MCP Tools

1. **memory_search_L0** - Retrieve working set for a session
2. **memory_search_L1** - Search episodic memory
3. **memory_search_L2** - Search semantic memory (hybrid)
4. **memory_search_L3** - Search knowledge base (hybrid)
5. **memory_list_L3_documents** - List documents with filters

## Configuration Options

### L0 Config
```typescript
{
  enabled: boolean
  maxMessages?: number // default: 12
  maxSessionSummaryTokens?: number // default: 300
  pinnedFactsMaxTokens?: number // default: 200
  storage: 'redis' | 'memory'
  redis?: {
    host?: string
    port?: number
    password?: string
    namespace?: string
  }
}
```

### L1 Config
```typescript
{
  enabled: boolean
  sessionDurationHours?: number // default: 24
  maxMessagesPerSession?: number
  cacheEnabled?: boolean // default: true
  cacheSize?: number // default: 1000
  storage: 'redis' | 'postgres' | 'both'
  redis?: { ... }
  postgres?: { ... }
}
```

### L2 Config
```typescript
{
  enabled: boolean
  chunkSize?: number // default: 1000
  chunkOverlap?: number // default: 200
  hybridSearch?: boolean // default: true
  storage: 'postgres-pgvector' | 'paradedb'
  embedding?: {
    provider: 'openai' | 'openai-compatible' | 'cloudflare'
    apiKey: string
    model: string
    baseUrl?: string
  }
  postgres?: {
    connectionString?: string
    tableName?: string
    indexType?: 'ivfflat' | 'hnsw' // default: 'hnsw'
  }
}
```

### L3 Config
```typescript
{
  enabled: boolean
  chunkSize?: number // default: 2000
  chunkOverlap?: number // default: 400
  hybridSearch?: boolean // default: true
  versioningEnabled?: boolean // default: true
  storage: 'postgres-pgvector' | 'paradedb'
  embedding?: { ... }
  postgres?: { ... }
  scopeFilters?: {
    repositories?: string[]
    branches?: string[]
    paths?: string[]
    languages?: string[]
    fileTypes?: string[]
  }
}
```

## Database Setup

### PostgreSQL with pgvector

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Tables will be created automatically on initialization
-- L1: l1_messages
-- L2: l2_chunks
-- L3: l3_documents, l3_documents_chunks
```

### Redis

No special setup required. The package will create keys with appropriate namespaces.

## Migration from Legacy System

The package maintains backward compatibility with the old memory system. You can gradually migrate:

```typescript
// Old system still works
import { MemorySystemFactory } from '@proj-airi/memory-multilevel'
const oldMemory = MemorySystemFactory.create({ ... })

// New system
import { createMultilevelMemory } from '@proj-airi/memory-multilevel'
const newMemory = createMultilevelMemory({ ... })
```

## Performance Considerations

- **L0**: In-memory + Redis = sub-millisecond access
- **L1**: Redis cache + Postgres = ~1-10ms for cached, ~10-50ms for DB queries
- **L2**: Vector search = ~50-200ms depending on index size
- **L3**: Vector search with filters = ~100-500ms depending on corpus size

Use HNSW indexes for better performance on large datasets (>100k vectors).

## License

MIT

# Integrazione Multilevel Memory in Tamagotchi

Questa guida documenta l'integrazione del sistema di memoria multilivello (L0-L3) nel progetto **stage-tamagotchi**.

## 📦 File Creati

### Store
- **`packages/stage-ui/src/stores/memory-multilevel.ts`**
  - Store Pinia per gestire la configurazione e lo stato della memoria multilivello
  - Supporta tutti e 4 i livelli (L0-L3) con configurazione persistente in localStorage
  - Lazy initialization del memory manager
  - Export di azioni per ogni livello (L0: working set, L1: episodic, L2: semantic, L3: knowledge)

### Composables
- **`packages/stage-ui/src/composables/useMultilevelMemory.ts`**
  - Composable user-friendly per operazioni comuni
  - Funzioni semplificate: `addMessage()`, `saveNote()`, `indexDocument()`, etc.
  - Gestione automatica dell'inizializzazione
  - Support per sessionId e error handling

- **`packages/stage-ui/src/composables/useMultilevelMemoryMcp.ts`**
  - Composable per MCP tools (Model Context Protocol)
  - Expose 5 funzioni MCP: `mcpSearchL0`, `mcpSearchL1`, `mcpSearchL2`, `mcpSearchL3`, `mcpListL3Documents`
  - Ritorna response structure compatibili con MCP tools schema

### Pages
- **`packages/stage-pages/src/pages/settings/modules/memory-multilevel.vue`**
  - Pagina settings completa per configurare tutti e 4 i livelli
  - Master enable/disable toggle
  - Configurazioni per ogni livello:
    - L0: storage type (RAM/Redis), max messages, max tokens, key prefix
    - L1: storage type (Redis/Postgres/Both), TTL, table name
    - L2: Postgres URL, OpenAI API key, embedding model, hybrid search
    - L3: Postgres URL, OpenAI API key, embedding model, hybrid search
  - Status indicators per ogni livello
  - Initialize/Reset buttons
  - Error display

## 🔧 Installazione

### 1. Aggiungere Dipendenza

Aggiungi `@proj-airi/memory-multilevel` al `package.json` di **stage-ui**:

```json
{
  "dependencies": {
    "@proj-airi/memory-multilevel": "workspace:^"
  }
}
```

Poi esegui:
```bash
pnpm install
```

### 2. Configurare Route

La pagina settings è già configurata con `<route>` metadata. Verifica che il router la rilevi automaticamente.

Se necessario, aggiungi manualmente la route in `apps/stage-tamagotchi/electron.vite.config.ts` o nel router config:

```ts
{
  path: '/settings/modules/memory-multilevel',
  component: () => import('@proj-airi/stage-pages/src/pages/settings/modules/memory-multilevel.vue'),
  meta: {
    layout: 'settings',
    titleKey: 'settings.pages.modules.memory-multilevel.title',
    subtitleKey: 'settings.title',
  }
}
```

### 3. Aggiungere Traduzioni

Aggiungi le chiavi i18n necessarie in `packages/i18n/locales/en.json` (e altre lingue):

```json
{
  "settings": {
    "pages": {
      "modules": {
        "memory-multilevel": {
          "title": "Multilevel Memory"
        }
      }
    },
    "memory": {
      "multilevel": {
        "title": "Multilevel Memory System",
        "description": "4-level memory architecture: L0 (Working Set), L1 (Episodic), L2 (Semantic), L3 (Knowledge Base)",
        "enabled": "Enable Multilevel Memory",
        "status": "Status",
        "warning_config": "Configuration incomplete. Configure L0, L1 (and optionally L2/L3) in the tabs below.",
        "l0": {
          "desc": "6-12 recent messages",
          "subtitle": "Recent messages, session summary, pinned facts",
          "storage": "Storage Type",
          "storage_memory": "In-Memory (RAM)",
          "storage_redis": "Redis",
          "redis_url": "Redis URL",
          "max_messages": "Max Messages",
          "max_messages_hint": "Recommended: 6-12 messages",
          "max_tokens": "Max Tokens",
          "key_prefix": "Key Prefix"
        },
        "l1": {
          "desc": "Sessions with TTL",
          "subtitle": "Session-based conversations with TTL",
          "storage": "Storage Type",
          "storage_redis": "Redis Only",
          "storage_postgres": "PostgreSQL Only",
          "storage_both": "Redis + PostgreSQL (Recommended)",
          "redis_url": "Redis URL",
          "postgres_url": "PostgreSQL URL",
          "session_ttl": "Session TTL (seconds)",
          "session_ttl_hint": "Default: 7 days (604800s)",
          "table_name": "Table Name",
          "key_prefix": "Key Prefix (Redis)"
        },
        "l2": {
          "desc": "Semantic search + embeddings",
          "subtitle": "Conversations, notes, snippets with semantic search",
          "postgres_url": "PostgreSQL URL (with pgvector)",
          "table_name": "Table Name",
          "openai_api_key": "OpenAI API Key",
          "openai_base_url": "OpenAI Base URL (Optional)",
          "embedding_model": "Embedding Model",
          "use_hybrid_search": "Enable Hybrid Search",
          "use_hybrid_search_hint": "Combines vector + keyword search"
        },
        "l3": {
          "desc": "Documents + versioning",
          "subtitle": "Documents, code, markdown with semantic search + versioning",
          "postgres_url": "PostgreSQL URL (with pgvector)",
          "table_name": "Table Name",
          "openai_api_key": "OpenAI API Key",
          "openai_base_url": "OpenAI Base URL (Optional)",
          "embedding_model": "Embedding Model",
          "use_hybrid_search": "Enable Hybrid Search",
          "use_hybrid_search_hint": "Combines vector + keyword search"
        }
      }
    }
  },
  "common": {
    "enabled": "Enabled",
    "disabled": "Disabled",
    "initialized": "Initialized",
    "not_initialized": "Not Initialized",
    "loading": "Loading...",
    "initialize": "Initialize",
    "reset": "Reset",
    "success": "Success"
  }
}
```

## 🚀 Utilizzo

### In un Componente Vue

#### Operazioni Semplificate

```vue
<script setup lang="ts">
import { useMultilevelMemory } from '@proj-airi/stage-ui/composables/useMultilevelMemory'

const memory = useMultilevelMemory()

// Initialize (auto-called on first action)
await memory.initialize()

// Add message to working set (L0) and episodic memory (L1)
await memory.addMessage('user', 'Hello!', { userId: 'user-123' })

// Get working set
const { data: workingSet } = await memory.getWorkingSet()
console.log(workingSet.messages) // Array<L0Message>
console.log(workingSet.summary) // Session summary
console.log(workingSet.pinnedFacts) // Object with pinned facts

// Search in current session (L1)
const { data: messages } = await memory.searchInSession('hello')

// Save a note to semantic memory (L2)
await memory.saveNote({
  content: 'Important note about project',
  sourceType: 'note',
  sourceId: 'note-123',
  userId: 'user-123',
  tags: ['project', 'important']
})

// Search semantic memory (L2)
const { data: semanticResults } = await memory.searchSemanticMemory('project notes', 'user-123', 10)

// Index a document in knowledge base (L3)
await memory.indexDocument({
  content: '# README\n\nProject documentation...',
  path: 'docs/README.md',
  repository: 'my-repo',
  userId: 'user-123',
  language: 'markdown',
  scope: 'public'
})

// Search knowledge base (L3)
const { data: docs } = await memory.searchKnowledge('README', 'my-repo', 5)
</script>
```

#### MCP Tools (per AI Models)

```vue
<script setup lang="ts">
import { useMultilevelMemoryMcp } from '@proj-airi/stage-ui/composables/useMultilevelMemoryMcp'

const mcp = useMultilevelMemoryMcp()

// L0 Search (working set)
const l0Result = await mcp.mcpSearchL0('session-id-123')
console.log(l0Result.data.messages)
console.log(l0Result.data.summary)

// L1 Search (episodic)
const l1Result = await mcp.mcpSearchL1({
  sessionId: 'session-id-123',
  query: 'project discussion',
  limit: 10
})
console.log(l1Result.data.messages)

// L2 Search (semantic)
const l2Result = await mcp.mcpSearchL2({
  query: 'important notes',
  filters: { userId: 'user-123', tags: ['important'] },
  options: { limit: 5 }
})
console.log(l2Result.data.chunks)

// L3 Search (knowledge)
const l3Result = await mcp.mcpSearchL3({
  query: 'documentation',
  filters: { repository: 'my-repo' },
  options: { limit: 10 }
})
console.log(l3Result.data.documents)

// L3 List documents
const l3List = await mcp.mcpListL3Documents({
  filters: { repository: 'my-repo', scope: 'public' },
  limit: 20
})
console.log(l3List.data.documents)
</script>
```

#### Store Diretto (Advanced)

```vue
<script setup lang="ts">
import { useMultilevelMemoryStore } from '@proj-airi/stage-ui/stores/memory-multilevel'
import { storeToRefs } from 'pinia'

const memoryStore = useMultilevelMemoryStore()
const { enabled, initialized, l0Enabled, l1Enabled, l2Enabled, l3Enabled } = storeToRefs(memoryStore)

// Enable multilevel memory
enabled.value = true

// Configure L0
l0Enabled.value = true
l0Storage.value = 'redis'
l0RedisUrl.value = 'redis://localhost:6379'
l0MaxMessages.value = 10

// Initialize
await memoryStore.initialize()

// Direct L0 operations
await memoryStore.l0AddMessage('session-123', {
  role: 'user',
  content: 'Hello',
  timestamp: new Date()
})

const workingSet = await memoryStore.l0GetWorkingSet('session-123')

// Direct L1 operations
await memoryStore.l1AddMessage('session-123', {
  sessionId: 'session-123',
  userId: 'user-123',
  role: 'user',
  content: 'Hello',
  timestamp: new Date()
})

const sessions = await memoryStore.l1ListActiveSessions('user-123', 10)

// Direct L2 operations
if (l2Enabled.value) {
  const chunkId = await memoryStore.l2AddChunk({
    chunkId: crypto.randomUUID(),
    content: 'Important note',
    sourceType: 'note',
    sourceId: 'n1',
    userId: 'user-123',
    timestamp: new Date()
  })
}

// Direct L3 operations
if (l3Enabled.value) {
  const docId = await memoryStore.l3AddDocument({
    docId: crypto.randomUUID(),
    content: '# README',
    path: 'README.md',
    repository: 'repo',
    userId: 'user-123',
    timestamp: new Date()
  })
}
</script>
```

## 🔗 Integrazione con Chat Orchestrator

Per integrare la multilevel memory con il chat orchestrator esistente:

```ts
// In chat orchestrator o message handler
import { useMultilevelMemory } from '@proj-airi/stage-ui/composables/useMultilevelMemory'

const memory = useMultilevelMemory(currentSessionId)

// On user message
await memory.addMessage('user', userMessage, {
  userId: currentUserId,
  timestamp: new Date()
})

// On assistant response
await memory.addMessage('assistant', assistantResponse, {
  userId: currentUserId,
  timestamp: new Date()
})

// Get context for next message (working set)
const { data: workingSet } = await memory.getWorkingSet()
const context = {
  recentMessages: workingSet.messages,
  summary: workingSet.summary,
  pinnedFacts: workingSet.pinnedFacts
}

// Use context in LLM prompt
const prompt = `
Context:
${workingSet.summary || 'No summary yet'}

Pinned Facts:
${Object.entries(workingSet.pinnedFacts).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

Recent Messages:
${workingSet.messages.map(m => `${m.role}: ${m.content}`).join('\n')}

User: ${userMessage}
Assistant:
`
```

## ⚙️ Configurazione Minima

### Solo L0 + L1 (Base)

Per una configurazione minima funzionante:

1. **L0**: In-memory (RAM) o Redis
2. **L1**: Redis + Postgres (recommended) o solo Postgres

Esempio localStorage:
```json
{
  "settings/memory-multilevel/enabled": true,
  "settings/memory-multilevel/l0/enabled": true,
  "settings/memory-multilevel/l0/storage": "memory",
  "settings/memory-multilevel/l1/enabled": true,
  "settings/memory-multilevel/l1/storage": "postgres",
  "settings/memory-multilevel/l1/postgres-url": "postgresql://user:pass@localhost:5432/db"
}
```

### Con L2 + L3 (Full)

Aggiungi:
- PostgreSQL con pgvector extension
- OpenAI API key per embeddings

Esempio localStorage:
```json
{
  "settings/memory-multilevel/l2/enabled": true,
  "settings/memory-multilevel/l2/postgres-url": "postgresql://...",
  "settings/memory-multilevel/l2/openai-api-key": "sk-...",
  "settings/memory-multilevel/l3/enabled": true,
  "settings/memory-multilevel/l3/postgres-url": "postgresql://...",
  "settings/memory-multilevel/l3/openai-api-key": "sk-..."
}
```

## 📊 Struttura Dati

### L0 Working Set
```ts
{
  messages: Array<{
    role: 'user' | 'assistant' | 'system',
    content: string,
    timestamp: Date,
    metadata?: Record<string, unknown>
  }>,
  summary: string, // Session summary
  pinnedFacts: Record<string, string>, // Key-value facts
  totalTokens: number
}
```

### L1 Session
```ts
{
  sessionId: string,
  userId: string,
  messages: Array<L1Message>,
  createdAt: Date,
  lastAccessedAt: Date
}
```

### L2 Chunk
```ts
{
  chunkId: string,
  content: string,
  sourceType: string, // 'conversation' | 'note' | 'snippet'
  sourceId: string,
  userId: string,
  timestamp: Date,
  metadata?: Record<string, unknown>,
  tags?: string[]
}
```

### L3 Document
```ts
{
  docId: string,
  content: string,
  path: string,
  repository: string,
  userId: string,
  timestamp: Date,
  language?: string,
  scope?: string, // 'private' | 'public' | 'shared'
  version?: number,
  metadata?: Record<string, unknown>,
  tags?: string[]
}
```

## 🐛 Troubleshooting

### TypeScript Errors

Se vedi errori su `@proj-airi/memory-multilevel` non trovato:
- Assicurati di aver aggiunto la dipendenza in `packages/stage-ui/package.json`
- Run `pnpm install` dal root del progetto
- Restart TypeScript server in VS Code (Command Palette → "TypeScript: Restart TS Server")

### Runtime Errors

**"Cannot find module '@proj-airi/memory-multilevel'"**
- Verifica che il package `packages/memory-multilevel` esista
- Run `pnpm install` per linkare i workspace packages

**"Multilevel memory not configured"**
- Vai in Settings → Modules → Multilevel Memory
- Abilita il sistema e configura almeno L0 e L1
- Click "Initialize"

**"L2 provider not configured"**
- L2 è opzionale. Abilitalo solo se hai Postgres + pgvector + OpenAI API key

## ✅ Testing

```bash
# Typecheck
pnpm -F @proj-airi/stage-ui typecheck

# Test (se esistono test)
pnpm -F @proj-airi/stage-ui test:run

# Build Tamagotchi app
pnpm -F @proj-airi/stage-tamagotchi build
```

## 📚 Riferimenti

- **Package Memory Multilevel**: `packages/memory-multilevel/README.md`
- **MCP Tools Specification**: `packages/memory-multilevel/src/mcp/README.md`
- **Store Pattern**: `packages/stage-ui/src/stores/memory.ts` (esistente)
- **Settings Pattern**: `packages/stage-pages/src/pages/settings/memory/` (componenti esistenti)

---

**Integrazione completata!** 🎉

Il sistema di memoria multilivello è ora disponibile in stage-tamagotchi. Configura le impostazioni nella pagina `/settings/modules/memory-multilevel` e inizia a utilizzare i composable nei tuoi componenti.

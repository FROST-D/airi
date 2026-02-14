import type { L0Message, L2Chunk, L3Document } from '@proj-airi/memory-multilevel'

import { computed, ref } from 'vue'

import { useMultilevelMemoryStore } from '../stores/memory-multilevel'

/**
 * Composable user-friendly per utilizzare la memoria MultiLevel
 *
 * Espone funzioni semplificate per le operazioni più comuni:
 * - Gestione working set (L0)
 * - Salvataggio messaggi (L1)
 * - Salvataggio note/snippets (L2)
 * - Indicizzazione documenti (L3)
 */
export function useMultilevelMemory(sessionId?: string) {
  const memoryStore = useMultilevelMemoryStore()

  const currentSessionId = ref(sessionId || crypto.randomUUID())
  const isLoading = ref(false)
  const lastError = ref<string | null>(null)

  const isReady = computed(() => memoryStore.initialized && !memoryStore.initializationError)
  const isEnabled = computed(() => memoryStore.enabled)

  /**
   * Inizializza la memoria multilevel
   */
  async function initialize() {
    if (isReady.value) {
      return { success: true }
    }

    if (!memoryStore.enabled) {
      return {
        success: false,
        error: 'Multilevel memory is disabled in settings',
      }
    }

    try {
      await memoryStore.initialize()
      return { success: true }
    }
    catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        error: lastError.value,
      }
    }
  }

  // ===================
  // L0 - Working Set Operations
  // ===================

  /**
   * Aggiunge un messaggio al working set della sessione corrente
   */
  async function addMessage(role: 'user' | 'assistant' | 'system', content: string, metadata?: Record<string, unknown>) {
    await initialize()

    const message: L0Message = {
      role,
      content,
      timestamp: new Date(),
      metadata,
    }

    isLoading.value = true
    lastError.value = null

    try {
      await memoryStore.l0AddMessage(currentSessionId.value, message)
      // Salva anche in L1 (episodic memory)
      await memoryStore.l1AddMessage({
        ...message,
        messageId: crypto.randomUUID(),
        sessionId: currentSessionId.value,
        userId: metadata?.userId as string || 'default-user',
      })
      return { success: true }
    }
    catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return { success: false, error: lastError.value }
    }
    finally {
      isLoading.value = false
    }
  }

  /**
   * Ottiene il working set corrente
   */
  async function getWorkingSet() {
    await initialize()

    isLoading.value = true
    lastError.value = null

    try {
      const workingSet = await memoryStore.l0GetWorkingSet(currentSessionId.value)
      return { success: true, data: workingSet }
    }
    catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return { success: false, data: null, error: lastError.value }
    }
    finally {
      isLoading.value = false
    }
  }

  /**
   * Imposta il summary della sessione
   */
  async function setSummary(summary: string) {
    await initialize()

    isLoading.value = true
    lastError.value = null

    try {
      await memoryStore.l0SetSessionSummary(currentSessionId.value, {
        summary,
        tokenCount: summary.length,
        lastUpdated: new Date(),
      })
      return { success: true }
    }
    catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return { success: false, error: lastError.value }
    }
    finally {
      isLoading.value = false
    }
  }

  /**
   * Aggiunge un fatto pinned al working set
   */
  async function addPinnedFact(key: string, value: string) {
    await initialize()

    isLoading.value = true
    lastError.value = null

    try {
      await memoryStore.l0SetPinnedFact(currentSessionId.value, {
        key,
        value,
        tokenCount: value.length,
      })
      return { success: true }
    }
    catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return { success: false, error: lastError.value }
    }
    finally {
      isLoading.value = false
    }
  }

  /**
   * Rimuove un fatto pinned
   */
  async function removePinnedFact(key: string) {
    await initialize()

    isLoading.value = true
    lastError.value = null

    try {
      await memoryStore.l0RemovePinnedFact(currentSessionId.value, key)
      return { success: true }
    }
    catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return { success: false, error: lastError.value }
    }
    finally {
      isLoading.value = false
    }
  }

  /**
   * Pulisce il working set
   */
  async function clearWorkingSet() {
    await initialize()

    isLoading.value = true
    lastError.value = null

    try {
      await memoryStore.l0ClearSession(currentSessionId.value)
      return { success: true }
    }
    catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return { success: false, error: lastError.value }
    }
    finally {
      isLoading.value = false
    }
  }

  // ===================
  // L1 - Episodic Memory Operations
  // ===================

  /**
   * Cerca messaggi nella sessione corrente
   */
  async function searchInSession(query: string, limit?: number) {
    await initialize()

    isLoading.value = true
    lastError.value = null

    try {
      const messages = await memoryStore.l1SearchInSession(currentSessionId.value, query, limit)
      return { success: true, data: messages }
    }
    catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return { success: false, data: [], error: lastError.value }
    }
    finally {
      isLoading.value = false
    }
  }

  /**
   * Ottiene tutti i messaggi della sessione corrente
   */
  async function getSession() {
    await initialize()

    isLoading.value = true
    lastError.value = null

    try {
      const session = await memoryStore.l1GetSession(currentSessionId.value)
      return { success: true, data: session }
    }
    catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return { success: false, data: null, error: lastError.value }
    }
    finally {
      isLoading.value = false
    }
  }

  /**
   * Elimina la sessione corrente
   */
  async function deleteSession() {
    await initialize()

    isLoading.value = true
    lastError.value = null

    try {
      await memoryStore.l1ClearSession(currentSessionId.value)
      // Rigenera sessionId per futuri salvataggi
      currentSessionId.value = crypto.randomUUID()
      return { success: true }
    }
    catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return { success: false, error: lastError.value }
    }
    finally {
      isLoading.value = false
    }
  }

  // ===================
  // L2 - Semantic Memory Operations
  // ===================

  /**
   * Salva una nota/snippet in semantic memory
   */
  async function saveNote(params: {
    content: string
    sourceType: string
    sourceId: string
    userId: string
    metadata?: Record<string, unknown>
    tags?: string[]
  }) {
    await initialize()

    if (!memoryStore.l2Enabled) {
      return { success: false, error: 'L2 Semantic Memory is disabled' }
    }

    const chunk: L2Chunk = {
      chunkId: crypto.randomUUID(),
      content: params.content,
      source: params.sourceType,
      sourceId: params.sourceId,
      tenantId: params.userId,
      timestamp: new Date(),
      metadata: params.metadata,
    }

    isLoading.value = true
    lastError.value = null

    try {
      await memoryStore.l2AddChunk(chunk)
      return { success: true, chunkId: chunk.chunkId }
    }
    catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return { success: false, error: lastError.value }
    }
    finally {
      isLoading.value = false
    }
  }

  /**
   * Cerca in semantic memory
   */
  async function searchSemanticMemory(query: string, userId?: string, limit?: number) {
    await initialize()

    if (!memoryStore.l2Enabled) {
      return { success: false, data: [], error: 'L2 Semantic Memory is disabled' }
    }

    isLoading.value = true
    lastError.value = null

    try {
      const chunks = await memoryStore.l2SearchHybrid(
        query,
        {
          filters: userId ? { userId } : undefined,
          limit,
        },
      )
      return { success: true, data: chunks }
    }
    catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return { success: false, data: [], error: lastError.value }
    }
    finally {
      isLoading.value = false
    }
  }

  // ===================
  // L3 - Knowledge Base Operations
  // ===================

  /**
   * Indicizza un documento in knowledge base
   */
  async function indexDocument(params: {
    content: string
    path: string
    repository: string
    userId: string
    language?: string
    scope?: string
    metadata?: Record<string, unknown>
    tags?: string[]
  }) {
    await initialize()

    if (!memoryStore.l3Enabled) {
      return { success: false, error: 'L3 Knowledge Base is disabled' }
    }

    const doc: L3Document = {
      documentId: crypto.randomUUID(),
      filePath: params.path,
      fileName: params.path.split('/').pop() || params.path,
      fileType: params.path.split('.').pop() || '',
      language: params.language,
      repository: params.repository,
      content: params.content,
      chunks: [],
      metadata: { ...params.metadata, userId: params.userId, scope: params.scope },
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    isLoading.value = true
    lastError.value = null

    try {
      await memoryStore.l3AddDocument(doc)
      return { success: true, docId: doc.documentId }
    }
    catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return { success: false, error: lastError.value }
    }
    finally {
      isLoading.value = false
    }
  }

  /**
   * Cerca nella knowledge base
   */
  async function searchKnowledge(query: string, repository?: string, limit?: number) {
    await initialize()

    if (!memoryStore.l3Enabled) {
      return { success: false, data: [], error: 'L3 Knowledge Base is disabled' }
    }

    isLoading.value = true
    lastError.value = null

    try {
      const documents = await memoryStore.l3SearchHybrid(
        query,
        {
          filters: repository ? { repository } : undefined,
          limit,
        },
      )
      return { success: true, data: documents }
    }
    catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return { success: false, data: [], error: lastError.value }
    }
    finally {
      isLoading.value = false
    }
  }

  /**
   * Ottiene un documento per path
   */
  async function getDocumentByPath(path: string) {
    await initialize()

    if (!memoryStore.l3Enabled) {
      return { success: false, data: null, error: 'L3 Knowledge Base is disabled' }
    }

    isLoading.value = true
    lastError.value = null

    try {
      // Note: getDocumentByPath not implemented in store yet, using listDocuments
      const docs = await memoryStore.l3ListDocuments({ path }, 1)
      const doc = docs.length > 0 ? docs[0] : null
      return { success: true, data: doc }
    }
    catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return { success: false, data: null, error: lastError.value }
    }
    finally {
      isLoading.value = false
    }
  }

  return {
    // State
    currentSessionId,
    isLoading,
    lastError,
    isReady,
    isEnabled,

    // Initialization
    initialize,

    // L0 - Working Set
    addMessage,
    getWorkingSet,
    setSummary,
    addPinnedFact,
    removePinnedFact,
    clearWorkingSet,

    // L1 - Episodic Memory
    searchInSession,
    getSession,
    deleteSession,

    // L2 - Semantic Memory
    saveNote,
    searchSemanticMemory,

    // L3 - Knowledge Base
    indexDocument,
    searchKnowledge,
    getDocumentByPath,
  }
}

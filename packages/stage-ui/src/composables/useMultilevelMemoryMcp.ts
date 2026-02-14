import type { SearchFilters, SearchOptions } from '@proj-airi/memory-multilevel'

import { computed, ref } from 'vue'

import { useMultilevelMemoryStore } from '../stores/memory-multilevel'

/**
 * Composable per interagire con MCP tools del sistema MultiLevel Memory
 *
 * Espone le funzioni MCP (Model Context Protocol) in modo Vue-friendly,
 * per permettere ai modelli AI di cercare nella memoria dell'utente.
 */
export function useMultilevelMemoryMcp() {
  const memoryStore = useMultilevelMemoryStore()

  const isLoading = ref(false)
  const lastError = ref<string | null>(null)

  const isReady = computed(() => memoryStore.initialized && !memoryStore.initializationError)

  /**
   * MCP Tool: Cerca nel Working Set (L0)
   *
   * Restituisce i messaggi recenti, summary e pinned facts di una sessione.
   * Utile per avere il contesto immediato della conversazione.
   */
  async function mcpSearchL0(sessionId: string) {
    if (!isReady.value) {
      throw new Error('Multilevel memory not initialized')
    }

    isLoading.value = true
    lastError.value = null

    try {
      const workingSet = await memoryStore.l0GetWorkingSet(sessionId)

      if (!workingSet) {
        return {
          success: false,
          data: null,
          error: 'Working set not found for this session',
        }
      }

      return {
        success: true,
        data: {
          messages: workingSet.messages,
          summary: workingSet.sessionSummary?.summary,
          pinnedFacts: workingSet.pinnedFacts,
          totalTokens: workingSet.totalTokens,
        },
        error: null,
      }
    }
    catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        data: null,
        error: lastError.value,
      }
    }
    finally {
      isLoading.value = false
    }
  }

  /**
   * MCP Tool: Cerca in Episodic Memory (L1)
   *
   * Cerca messaggi in una specifica sessione usando keyword search.
   * Utile per recuperare informazioni da conversazioni passate recenti.
   */
  async function mcpSearchL1(params: {
    sessionId: string
    query: string
    limit?: number
  }) {
    if (!isReady.value) {
      throw new Error('Multilevel memory not initialized')
    }

    isLoading.value = true
    lastError.value = null

    try {
      const messages = await memoryStore.l1SearchInSession(
        params.sessionId,
        params.query,
        params.limit,
      )

      return {
        success: true,
        data: {
          messages,
          count: messages.length,
        },
        error: null,
      }
    }
    catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        data: null,
        error: lastError.value,
      }
    }
    finally {
      isLoading.value = false
    }
  }

  /**
   * MCP Tool: Cerca in Semantic Memory (L2)
   *
   * Cerca in conversazioni, note, snippets usando semantic/hybrid search.
   * Supporta filtri per tipo di sorgente, userId, tags, etc.
   */
  async function mcpSearchL2(params: {
    query: string
    filters?: SearchFilters
    options?: SearchOptions
  }) {
    if (!isReady.value) {
      throw new Error('Multilevel memory not initialized')
    }

    if (!memoryStore.l2Enabled) {
      return {
        success: false,
        data: null,
        error: 'L2 Semantic Memory is not enabled',
      }
    }

    isLoading.value = true
    lastError.value = null

    try {
      const chunks = await memoryStore.l2SearchHybrid(
        params.query,
        { ...params.options, filters: params.filters },
      )

      return {
        success: true,
        data: {
          chunks,
          count: chunks.length,
        },
        error: null,
      }
    }
    catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        data: null,
        error: lastError.value,
      }
    }
    finally {
      isLoading.value = false
    }
  }

  /**
   * MCP Tool: Cerca in Knowledge Base (L3)
   *
   * Cerca in documenti, codice, markdown usando semantic/hybrid search.
   * Supporta filtri per repository, path, tags, scope.
   */
  async function mcpSearchL3(params: {
    query: string
    filters?: SearchFilters
    options?: SearchOptions
  }) {
    if (!isReady.value) {
      throw new Error('Multilevel memory not initialized')
    }

    if (!memoryStore.l3Enabled) {
      return {
        success: false,
        data: null,
        error: 'L3 Knowledge Base is not enabled',
      }
    }

    isLoading.value = true
    lastError.value = null

    try {
      const documents = await memoryStore.l3SearchHybrid(
        params.query,
        { ...params.options, filters: params.filters },
      )

      return {
        success: true,
        data: {
          documents,
          count: documents.length,
        },
        error: null,
      }
    }
    catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        data: null,
        error: lastError.value,
      }
    }
    finally {
      isLoading.value = false
    }
  }

  /**
   * MCP Tool: Lista documenti in Knowledge Base (L3)
   *
   * Restituisce una lista di documenti con filtri opzionali.
   * Utile per browse/esplorazione della knowledge base.
   */
  async function mcpListL3Documents(params?: {
    filters?: SearchFilters
    limit?: number
  }) {
    if (!isReady.value) {
      throw new Error('Multilevel memory not initialized')
    }

    if (!memoryStore.l3Enabled) {
      return {
        success: false,
        data: null,
        error: 'L3 Knowledge Base is not enabled',
      }
    }

    isLoading.value = true
    lastError.value = null

    try {
      const documents = await memoryStore.l3ListDocuments(
        params?.filters,
        params?.limit,
      )

      return {
        success: true,
        data: {
          documents,
          count: documents.length,
        },
        error: null,
      }
    }
    catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        data: null,
        error: lastError.value,
      }
    }
    finally {
      isLoading.value = false
    }
  }

  /**
   * Helper: Recupera sessioni attive per un utente
   * (non è un MCP tool ma è utile per UI)
   */
  async function listActiveSessions(userId: string, limit?: number) {
    if (!isReady.value) {
      throw new Error('Multilevel memory not initialized')
    }

    isLoading.value = true
    lastError.value = null

    try {
      const sessions = await memoryStore.l1ListActiveSessions(userId, limit)

      return {
        success: true,
        data: sessions,
        error: null,
      }
    }
    catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        data: null,
        error: lastError.value,
      }
    }
    finally {
      isLoading.value = false
    }
  }

  return {
    // State
    isLoading,
    lastError,
    isReady,

    // MCP Tools
    mcpSearchL0,
    mcpSearchL1,
    mcpSearchL2,
    mcpSearchL3,
    mcpListL3Documents,

    // Helpers
    listActiveSessions,
  }
}

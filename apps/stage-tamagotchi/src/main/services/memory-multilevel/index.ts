import type { MultilevelMemoryManager } from '@proj-airi/memory-multilevel'

import { useLogg } from '@guiiai/logg'
import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { ipcMain } from 'electron'

import {
  memoryMultilevelGetStatus,
  memoryMultilevelInitialize,
  memoryMultilevelL0AddMessage,
  memoryMultilevelL0ClearMessages,
  memoryMultilevelL0ClearSession,
  memoryMultilevelL0GetWorkingSet,
  memoryMultilevelL0RemovePinnedFact,
  memoryMultilevelL0SetPinnedFact,
  memoryMultilevelL0SetSessionSummary,
  memoryMultilevelL1AddMessage,
  memoryMultilevelL1ClearSession,
  memoryMultilevelL1ExpireSessions,
  memoryMultilevelL1GetSession,
  memoryMultilevelL1ListActiveSessions,
  memoryMultilevelL1SearchInSession,
  memoryMultilevelL2AddChunk,
  memoryMultilevelL2DeleteBySource,
  memoryMultilevelL2ListBySource,
  memoryMultilevelL2SearchHybrid,
  memoryMultilevelL3AddDocument,
  memoryMultilevelL3DeleteDocument,
  memoryMultilevelL3GetDocument,
  memoryMultilevelL3ListDocuments,
  memoryMultilevelL3SearchHybrid,
} from '../../../shared/eventa'

const log = useLogg('main/services/memory-multilevel').useGlobalConfig()

let memoryManager: MultilevelMemoryManager | null = null
let currentConfig: any = null

export function setupMemoryMultilevelService() {
  const { context } = createContext(ipcMain)

  defineInvokeHandler(context, memoryMultilevelInitialize, async (payload) => {
    try {
      log.debug('Initializing memory multilevel system', payload.config)

      // Dynamic import to avoid bundling in renderer
      const { createMultilevelMemory } = await import('@proj-airi/memory-multilevel')

      memoryManager = createMultilevelMemory(payload.config as any)
      await memoryManager.initialize()
      currentConfig = payload.config

      log.debug('Memory multilevel system initialized successfully')
      return { success: true }
    }
    catch (error) {
      log.withError(error).error('Failed to initialize memory multilevel system')
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })

  defineInvokeHandler(context, memoryMultilevelGetStatus, () => {
    return {
      initialized: memoryManager !== null,
      config: currentConfig,
    }
  })

  // L0 Working Set Operations
  defineInvokeHandler(context, memoryMultilevelL0AddMessage, async (payload) => {
    if (!memoryManager?.L0)
      throw new Error('L0 provider not initialized')
    await memoryManager.L0.addMessage(payload.sessionId, payload.message)
  })

  defineInvokeHandler(context, memoryMultilevelL0GetWorkingSet, async (payload) => {
    if (!memoryManager?.L0)
      throw new Error('L0 provider not initialized')
    return await memoryManager.L0.getWorkingSet(payload.sessionId)
  })

  defineInvokeHandler(context, memoryMultilevelL0SetSessionSummary, async (payload) => {
    if (!memoryManager?.L0)
      throw new Error('L0 provider not initialized')
    await memoryManager.L0.setSessionSummary(payload.sessionId, payload.summary)
  })

  defineInvokeHandler(context, memoryMultilevelL0SetPinnedFact, async (payload) => {
    if (!memoryManager?.L0)
      throw new Error('L0 provider not initialized')
    await memoryManager.L0.setPinnedFact(payload.sessionId, payload.fact)
  })

  defineInvokeHandler(context, memoryMultilevelL0RemovePinnedFact, async (payload) => {
    if (!memoryManager?.L0)
      throw new Error('L0 provider not initialized')
    await memoryManager.L0.removePinnedFact(payload.sessionId, payload.key)
  })

  defineInvokeHandler(context, memoryMultilevelL0ClearMessages, async (payload) => {
    if (!memoryManager?.L0)
      throw new Error('L0 provider not initialized')
    // Note: IL0Provider doesn't have clearMessages, using clearSession
    await memoryManager.L0.clearSession(payload.sessionId)
  })

  defineInvokeHandler(context, memoryMultilevelL0ClearSession, async (payload) => {
    if (!memoryManager?.L0)
      throw new Error('L0 provider not initialized')
    await memoryManager.L0.clearSession(payload.sessionId)
  })

  // L1 Episodic Memory Operations
  defineInvokeHandler(context, memoryMultilevelL1AddMessage, async (payload) => {
    if (!memoryManager?.L1)
      throw new Error('L1 provider not initialized')
    await memoryManager.L1.addMessage(payload.message)
  })

  defineInvokeHandler(context, memoryMultilevelL1GetSession, async (payload) => {
    if (!memoryManager?.L1)
      throw new Error('L1 provider not initialized')
    return await memoryManager.L1.getSession(payload.sessionId)
  })

  defineInvokeHandler(context, memoryMultilevelL1ListActiveSessions, async (payload) => {
    if (!memoryManager?.L1)
      throw new Error('L1 provider not initialized')
    return await memoryManager.L1.listActiveSessions(payload.userId, payload.hours)
  })

  defineInvokeHandler(context, memoryMultilevelL1SearchInSession, async (payload) => {
    if (!memoryManager?.L1)
      throw new Error('L1 provider not initialized')
    return await memoryManager.L1.searchInSession(payload.sessionId, payload.query, payload.limit)
  })

  defineInvokeHandler(context, memoryMultilevelL1ClearSession, async (payload) => {
    if (!memoryManager?.L1)
      throw new Error('L1 provider not initialized')
    await memoryManager.L1.clearSession(payload.sessionId)
  })

  defineInvokeHandler(context, memoryMultilevelL1ExpireSessions, async (payload) => {
    if (!memoryManager?.L1)
      throw new Error('L1 provider not initialized')
    return await memoryManager.L1.expireSessions(payload.hoursBack)
  })

  // L2 Semantic Memory Operations
  defineInvokeHandler(context, memoryMultilevelL2AddChunk, async (payload) => {
    if (!memoryManager?.L2)
      throw new Error('L2 provider not initialized')
    await memoryManager.L2.addChunk(payload.chunk)
  })

  defineInvokeHandler(context, memoryMultilevelL2SearchHybrid, async (payload) => {
    if (!memoryManager?.L2)
      throw new Error('L2 provider not initialized')
    return await memoryManager.L2.searchHybrid(payload.query, payload.options)
  })

  defineInvokeHandler(context, memoryMultilevelL2ListBySource, async (payload) => {
    if (!memoryManager?.L2)
      throw new Error('L2 provider not initialized')
    const results = await memoryManager.L2.searchHybrid('*', {
      filters: { source: payload.sourceType },
      limit: payload.limit || 100,
    })
    return results.filter(r => r.chunk.sourceId === payload.sourceId).map(r => r.chunk)
  })

  defineInvokeHandler(context, memoryMultilevelL2DeleteBySource, async (payload) => {
    if (!memoryManager?.L2)
      throw new Error('L2 provider not initialized')
    return await memoryManager.L2.deleteBySource(payload.sourceType, payload.sourceId)
  })

  // L3 Knowledge Base Operations
  defineInvokeHandler(context, memoryMultilevelL3AddDocument, async (payload) => {
    if (!memoryManager?.L3)
      throw new Error('L3 provider not initialized')
    await memoryManager.L3.addDocument(payload.document)
  })

  defineInvokeHandler(context, memoryMultilevelL3SearchHybrid, async (payload) => {
    if (!memoryManager?.L3)
      throw new Error('L3 provider not initialized')
    return await memoryManager.L3.searchHybrid(payload.query, payload.options)
  })

  defineInvokeHandler(context, memoryMultilevelL3ListDocuments, async (payload) => {
    if (!memoryManager?.L3)
      throw new Error('L3 provider not initialized')
    return await memoryManager.L3.listDocuments(payload.filters, payload.limit, payload.offset)
  })

  defineInvokeHandler(context, memoryMultilevelL3GetDocument, async (payload) => {
    if (!memoryManager?.L3)
      throw new Error('L3 provider not initialized')
    return await memoryManager.L3.getDocument(payload.documentId)
  })

  defineInvokeHandler(context, memoryMultilevelL3DeleteDocument, async (payload) => {
    if (!memoryManager?.L3)
      throw new Error('L3 provider not initialized')
    await memoryManager.L3.deleteDocument(payload.documentId)
  })

  log.debug('Memory multilevel service registered')

  return {
    getManager: () => memoryManager,
    getConfig: () => currentConfig,
  }
}

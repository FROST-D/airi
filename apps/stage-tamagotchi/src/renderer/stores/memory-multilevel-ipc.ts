import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'

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
} from '../../shared/eventa'

let cachedInvokers: ReturnType<typeof createMemoryMultilevelInvokers> | undefined

export function createMemoryMultilevelInvokers() {
  const { context } = createContext(window.electron.ipcRenderer)

  // Create raw invokers
  const raw = {
    initialize: defineInvoke(context, memoryMultilevelInitialize),
    getStatus: defineInvoke(context, memoryMultilevelGetStatus),
    l0AddMessage: defineInvoke(context, memoryMultilevelL0AddMessage),
    l0GetWorkingSet: defineInvoke(context, memoryMultilevelL0GetWorkingSet),
    l0SetSessionSummary: defineInvoke(context, memoryMultilevelL0SetSessionSummary),
    l0SetPinnedFact: defineInvoke(context, memoryMultilevelL0SetPinnedFact),
    l0RemovePinnedFact: defineInvoke(context, memoryMultilevelL0RemovePinnedFact),
    l0ClearMessages: defineInvoke(context, memoryMultilevelL0ClearMessages),
    l0ClearSession: defineInvoke(context, memoryMultilevelL0ClearSession),
    l1AddMessage: defineInvoke(context, memoryMultilevelL1AddMessage),
    l1GetSession: defineInvoke(context, memoryMultilevelL1GetSession),
    l1ListActiveSessions: defineInvoke(context, memoryMultilevelL1ListActiveSessions),
    l1SearchInSession: defineInvoke(context, memoryMultilevelL1SearchInSession),
    l1ClearSession: defineInvoke(context, memoryMultilevelL1ClearSession),
    l1ExpireSessions: defineInvoke(context, memoryMultilevelL1ExpireSessions),
    l2AddChunk: defineInvoke(context, memoryMultilevelL2AddChunk),
    l2SearchHybrid: defineInvoke(context, memoryMultilevelL2SearchHybrid),
    l2ListBySource: defineInvoke(context, memoryMultilevelL2ListBySource),
    l2DeleteBySource: defineInvoke(context, memoryMultilevelL2DeleteBySource),
    l3AddDocument: defineInvoke(context, memoryMultilevelL3AddDocument),
    l3SearchHybrid: defineInvoke(context, memoryMultilevelL3SearchHybrid),
    l3ListDocuments: defineInvoke(context, memoryMultilevelL3ListDocuments),
    l3GetDocument: defineInvoke(context, memoryMultilevelL3GetDocument),
    l3DeleteDocument: defineInvoke(context, memoryMultilevelL3DeleteDocument),
  }

  // Wrap invokers to adapt signatures (they take req object, we want direct params)
  return {
    initialize: async (config: any) => raw.initialize({ config }),
    getStatus: async () => raw.getStatus(),
    l0AddMessage: async (payload: any) => raw.l0AddMessage(payload),
    l0GetWorkingSet: async (payload: any) => raw.l0GetWorkingSet(payload),
    l0SetSessionSummary: async (payload: any) => raw.l0SetSessionSummary(payload),
    l0SetPinnedFact: async (payload: any) => raw.l0SetPinnedFact(payload),
    l0RemovePinnedFact: async (payload: any) => raw.l0RemovePinnedFact(payload),
    l0ClearMessages: async (payload: any) => raw.l0ClearMessages(payload),
    l0ClearSession: async (payload: any) => raw.l0ClearSession(payload),
    l1AddMessage: async (payload: any) => raw.l1AddMessage(payload),
    l1GetSession: async (payload: any) => raw.l1GetSession(payload),
    l1ListActiveSessions: async (payload: any) => raw.l1ListActiveSessions(payload),
    l1SearchInSession: async (payload: any) => raw.l1SearchInSession(payload),
    l1ClearSession: async (payload: any) => raw.l1ClearSession(payload),
    l1ExpireSessions: async (payload: any) => raw.l1ExpireSessions(payload),
    l2AddChunk: async (payload: any) => raw.l2AddChunk(payload),
    l2SearchHybrid: async (payload: any) => raw.l2SearchHybrid(payload),
    l2ListBySource: async (payload: any) => raw.l2ListBySource(payload),
    l2DeleteBySource: async (payload: any) => raw.l2DeleteBySource(payload),
    l3AddDocument: async (payload: any) => raw.l3AddDocument(payload),
    l3SearchHybrid: async (payload: any) => raw.l3SearchHybrid(payload),
    l3ListDocuments: async (payload: any) => raw.l3ListDocuments(payload),
    l3GetDocument: async (payload: any) => raw.l3GetDocument(payload),
    l3DeleteDocument: async (payload: any) => raw.l3DeleteDocument(payload),
  } as any // Type assertion to bypass strict typing
}

export function getMemoryMultilevelInvokers() {
  if (!cachedInvokers) {
    cachedInvokers = createMemoryMultilevelInvokers()
  }
  return cachedInvokers
}

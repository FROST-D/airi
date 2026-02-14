import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

export const electronStartTrackMousePosition = defineInvokeEventa('eventa:invoke:electron:start-tracking-mouse-position')
export const electronStartDraggingWindow = defineInvokeEventa('eventa:invoke:electron:start-dragging-window')
export const electronOpenMainDevtools = defineInvokeEventa('eventa:invoke:electron:windows:main:devtools:open')
export const electronOpenSettings = defineInvokeEventa('eventa:invoke:electron:windows:settings:open')
export const electronOpenChat = defineInvokeEventa('eventa:invoke:electron:windows:chat:open')
export const electronOpenSettingsDevtools = defineInvokeEventa('eventa:invoke:electron:windows:settings:devtools:open')
export const electronOpenDevtoolsWindow = defineInvokeEventa<void, { route?: string }>('eventa:invoke:electron:windows:devtools:open')
export const electronStartWebSocketServer = defineInvokeEventa<{ success: boolean, error?: string }, { websocketSecureEnabled: boolean }>('eventa:invoke:electron:start-websocket-server')
export const electronRestartWebSocketServer = defineInvokeEventa<void, { websocketSecureEnabled: boolean }>('eventa:invoke:electron:restart-websocket-server')
export const captionIsFollowingWindowChanged = defineEventa<boolean>('eventa:event:electron:windows:caption-overlay:is-following-window-changed')
export const captionGetIsFollowingWindow = defineInvokeEventa<boolean>('eventa:invoke:electron:windows:caption-overlay:get-is-following-window')

export type RequestWindowActionDefault = 'confirm' | 'cancel' | 'close'
export interface RequestWindowPayload {
  id?: string
  route: string
  type?: string
  payload?: Record<string, any>
}
export interface RequestWindowPending {
  id: string
  type?: string
  payload?: Record<string, any>
}

// Reference window helpers are generic; callers can alias for clarity
export type NoticeAction = 'confirm' | 'cancel' | 'close'

export function createRequestWindowEventa(namespace: string) {
  const prefix = (name: string) => `eventa:${name}:electron:windows:${namespace}`
  return {
    openWindow: defineInvokeEventa<boolean, RequestWindowPayload>(prefix('invoke:open')),
    windowAction: defineInvokeEventa<void, { id: string, action: RequestWindowActionDefault }>(prefix('invoke:action')),
    pageMounted: defineInvokeEventa<RequestWindowPending | undefined, { id?: string }>(prefix('invoke:page-mounted')),
    pageUnmounted: defineInvokeEventa<void, { id?: string }>(prefix('invoke:page-unmounted')),
  }
}

// Notice window events built from generic factory
export const noticeWindowEventa = createRequestWindowEventa('notice')

// Widgets / Adhoc window events
export interface WidgetsAddPayload {
  id?: string
  componentName: string
  componentProps?: Record<string, any>
  // size presets or explicit spans; renderer decides mapping
  size?: 's' | 'm' | 'l' | { cols?: number, rows?: number }
  // auto-dismiss in ms; if omitted, persistent until closed by user
  ttlMs?: number
}

export interface WidgetSnapshot {
  id: string
  componentName: string
  componentProps: Record<string, any>
  size: 's' | 'm' | 'l' | { cols?: number, rows?: number }
  ttlMs: number
}

export const widgetsOpenWindow = defineInvokeEventa<void, { id?: string }>('eventa:invoke:electron:windows:widgets:open')
export const widgetsAdd = defineInvokeEventa<string | undefined, WidgetsAddPayload>('eventa:invoke:electron:windows:widgets:add')
export const widgetsRemove = defineInvokeEventa<void, { id: string }>('eventa:invoke:electron:windows:widgets:remove')
export const widgetsClear = defineInvokeEventa('eventa:invoke:electron:windows:widgets:clear')
export const widgetsUpdate = defineInvokeEventa<void, { id: string, componentProps?: Record<string, any> }>('eventa:invoke:electron:windows:widgets:update')
export const widgetsFetch = defineInvokeEventa<WidgetSnapshot | void, { id: string }>('eventa:invoke:electron:windows:widgets:fetch')
export const widgetsPrepareWindow = defineInvokeEventa<string | undefined, { id?: string }>('eventa:invoke:electron:windows:widgets:prepare')

// Internal event from main -> widgets renderer when a widget should render
export const widgetsRenderEvent = defineEventa<WidgetSnapshot>('eventa:event:electron:windows:widgets:render')
export const widgetsRemoveEvent = defineEventa<{ id: string }>('eventa:event:electron:windows:widgets:remove')
export const widgetsClearEvent = defineEventa('eventa:event:electron:windows:widgets:clear')
export const widgetsUpdateEvent = defineEventa<{ id: string, componentProps?: Record<string, any> }>('eventa:event:electron:windows:widgets:update')

export { electron } from './electron'
export * from './electron-updater'

export const modulesVisionPrepareScreenSourceSelection = defineInvokeEventa('eventa:invoke:modules:vision:prepare-screen-source-selection')

// Memory Multilevel Module
export interface MemoryMultilevelConfig {
  L0?: {
    enabled: boolean
    maxMessages?: number
    maxSessionSummaryTokens?: number
    pinnedFactsMaxTokens?: number
    storage: 'redis' | 'memory'
    redis?: {
      host?: string
      port?: number
      password?: string
      namespace?: string
    }
  }
  L1?: {
    enabled: boolean
    sessionDurationHours?: number
    maxMessagesPerSession?: number
    cacheEnabled?: boolean
    cacheSize?: number
    storage: 'redis' | 'postgres' | 'both'
    redis?: {
      host?: string
      port?: number
      password?: string
      namespace?: string
    }
    postgres?: {
      connectionString?: string
      tableName?: string
    }
  }
  L2?: {
    enabled: boolean
    chunkSize?: number
    chunkOverlap?: number
    hybridSearch?: boolean
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
      indexType?: 'ivfflat' | 'hnsw'
    }
  }
  L3?: {
    enabled: boolean
    chunkSize?: number
    chunkOverlap?: number
    hybridSearch?: boolean
    versioningEnabled?: boolean
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
      indexType?: 'ivfflat' | 'hnsw'
    }
  }
}

export const memoryMultilevelInitialize = defineInvokeEventa<{ success: boolean, error?: string }, { config: MemoryMultilevelConfig }>('eventa:invoke:memory-multilevel:initialize')
export const memoryMultilevelGetStatus = defineInvokeEventa<{ initialized: boolean, config?: MemoryMultilevelConfig }, void>('eventa:invoke:memory-multilevel:get-status')

// L0 Working Set Operations
export const memoryMultilevelL0AddMessage = defineInvokeEventa<void, { sessionId: string, message: any }>('eventa:invoke:memory-multilevel:l0:add-message')
export const memoryMultilevelL0GetWorkingSet = defineInvokeEventa<any, { sessionId: string }>('eventa:invoke:memory-multilevel:l0:get-working-set')
export const memoryMultilevelL0SetSessionSummary = defineInvokeEventa<void, { sessionId: string, summary: any }>('eventa:invoke:memory-multilevel:l0:set-session-summary')
export const memoryMultilevelL0SetPinnedFact = defineInvokeEventa<void, { sessionId: string, fact: any }>('eventa:invoke:memory-multilevel:l0:set-pinned-fact')
export const memoryMultilevelL0RemovePinnedFact = defineInvokeEventa<void, { sessionId: string, key: string }>('eventa:invoke:memory-multilevel:l0:remove-pinned-fact')
export const memoryMultilevelL0ClearMessages = defineInvokeEventa<void, { sessionId: string }>('eventa:invoke:memory-multilevel:l0:clear-messages')
export const memoryMultilevelL0ClearSession = defineInvokeEventa<void, { sessionId: string }>('eventa:invoke:memory-multilevel:l0:clear-session')

// L1 Episodic Memory Operations
export const memoryMultilevelL1AddMessage = defineInvokeEventa<void, { message: any }>('eventa:invoke:memory-multilevel:l1:add-message')
export const memoryMultilevelL1GetSession = defineInvokeEventa<any, { sessionId: string }>('eventa:invoke:memory-multilevel:l1:get-session')
export const memoryMultilevelL1ListActiveSessions = defineInvokeEventa<any[], { userId: string, hours?: number }>('eventa:invoke:memory-multilevel:l1:list-active-sessions')
export const memoryMultilevelL1SearchInSession = defineInvokeEventa<any[], { sessionId: string, query: string, limit?: number }>('eventa:invoke:memory-multilevel:l1:search-in-session')
export const memoryMultilevelL1ClearSession = defineInvokeEventa<void, { sessionId: string }>('eventa:invoke:memory-multilevel:l1:clear-session')
export const memoryMultilevelL1ExpireSessions = defineInvokeEventa<number, { hoursBack: number }>('eventa:invoke:memory-multilevel:l1:expire-sessions')

// L2 Semantic Memory Operations
export const memoryMultilevelL2AddChunk = defineInvokeEventa<void, { chunk: any }>('eventa:invoke:memory-multilevel:l2:add-chunk')
export const memoryMultilevelL2SearchHybrid = defineInvokeEventa<any[], { query: string, options?: any }>('eventa:invoke:memory-multilevel:l2:search-hybrid')
export const memoryMultilevelL2ListBySource = defineInvokeEventa<any[], { sourceType: string, sourceId: string, limit?: number }>('eventa:invoke:memory-multilevel:l2:list-by-source')
export const memoryMultilevelL2DeleteBySource = defineInvokeEventa<number, { sourceType: string, sourceId: string }>('eventa:invoke:memory-multilevel:l2:delete-by-source')

// L3 Knowledge Base Operations
export const memoryMultilevelL3AddDocument = defineInvokeEventa<void, { document: any }>('eventa:invoke:memory-multilevel:l3:add-document')
export const memoryMultilevelL3SearchHybrid = defineInvokeEventa<any[], { query: string, options?: any }>('eventa:invoke:memory-multilevel:l3:search-hybrid')
export const memoryMultilevelL3ListDocuments = defineInvokeEventa<any[], { filters?: any, limit?: number, offset?: number }>('eventa:invoke:memory-multilevel:l3:list-documents')
export const memoryMultilevelL3GetDocument = defineInvokeEventa<any, { documentId: string }>('eventa:invoke:memory-multilevel:l3:get-document')
export const memoryMultilevelL3DeleteDocument = defineInvokeEventa<void, { documentId: string }>('eventa:invoke:memory-multilevel:l3:delete-document')

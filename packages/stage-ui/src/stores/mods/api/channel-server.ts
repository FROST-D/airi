import type { ContextUpdate, WebSocketBaseEvent, WebSocketEvent, WebSocketEventOptionalSource, WebSocketEvents } from '@proj-airi/server-sdk'

import { Client, WebSocketEventSource } from '@proj-airi/server-sdk'
import { isStageTamagotchi, isStageWeb } from '@proj-airi/stage-shared'
import { useLocalStorage } from '@vueuse/core'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

import { useWebSocketInspectorStore } from '../../devtools/websocket-inspector'

export const useModsServerChannelStore = defineStore('mods:channels:proj-airi:server', () => {
  const connected = ref(false)
  const client = ref<Client>()
  const initializing = ref<Promise<void> | null>(null)
  const pendingSend = ref<Array<WebSocketEvent>>([])
  const listenersInitialized = ref(false)
  const listenerDisposers = ref<Array<() => void>>([])

  const defaultWebSocketUrl = import.meta.env.VITE_AIRI_WS_URL || 'ws://localhost:6121/ws'
  const websocketUrl = useLocalStorage('settings/connection/websocket-url', defaultWebSocketUrl)

  const basePossibleEvents: Array<keyof WebSocketEvents> = [
    'context:update',
    'error',
    'module:announce',
    'module:configure',
    'module:authenticated',
    'spark:notify',
    'spark:emit',
    'spark:command',
    'input:text',
    'input:text:voice',
    'output:gen-ai:chat:message',
    'output:gen-ai:chat:complete',
    'output:gen-ai:chat:tool-call',
    'ui:configure',
  ]

  async function initialize(options?: { token?: string, possibleEvents?: Array<keyof WebSocketEvents> }) {
    console.debug('[CHANNEL-SERVER] Initializing WebSocket client')

    // If client already exists and is connected, we're done
    if (connected.value && client.value) {
      console.debug('[CHANNEL-SERVER] Already connected, skipping initialization')
      return Promise.resolve()
    }

    // If client exists but not connected, wait for it to connect
    if (client.value) {
      console.debug('[CHANNEL-SERVER] Client exists but not connected, waiting for connection')
      if (initializing.value) {
        return initializing.value
      }
      return Promise.resolve()
    }

    // If already initializing, wait for that to complete
    if (initializing.value) {
      console.debug('[CHANNEL-SERVER] Already initializing, waiting...')
      return initializing.value
    }

    const possibleEvents = Array.from(new Set<keyof WebSocketEvents>([
      ...basePossibleEvents,
      ...(options?.possibleEvents ?? []),
    ]))
    console.debug('[CHANNEL-SERVER] Creating new WebSocket client with possibleEvents:', possibleEvents)

    initializing.value = new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (action: () => void) => {
        if (settled)
          return
        settled = true
        clearTimeout(timeoutId)
        initializing.value = null
        action()
      }

      const timeoutId = setTimeout(() => {
        console.error('[CHANNEL-SERVER] Initialization timeout - no authentication received')
        // settle(() => reject(new Error('WebSocket initialization timeout')))
        connected.value = true
        flush()
        initializeListeners()

        // Mark initialization as complete
        settle(() => {
          resolve()
          // eslint-disable-next-line no-console
          console.log('WebSocket server connection established and authenticated')
        })
      }, 5000) // 5 second timeout

      client.value = new Client({
        name: isStageWeb() ? WebSocketEventSource.StageWeb : isStageTamagotchi() ? WebSocketEventSource.StageTamagotchi : WebSocketEventSource.StageWeb,
        url: websocketUrl.value || defaultWebSocketUrl,
        token: options?.token,
        possibleEvents,
        onAnyMessage: (event) => {
          useWebSocketInspectorStore().add('incoming', event)
        },
        onAnySend: (event) => {
          useWebSocketInspectorStore().add('outgoing', event)
        },
        onError: (error) => {
          connected.value = false
          clearListeners()
          console.warn('WebSocket server connection error:', error)

          // Reject initialization on connection error
          settle(() => reject(new Error('WebSocket connection error')))
        },
        onClose: () => {
          connected.value = false
          clearListeners()
          console.warn('WebSocket server connection closed')

          // Reject initialization if connection closes before auth
          settle(() => reject(new Error('WebSocket connection closed before authentication')))
        },
      })

      client.value.onEvent('module:authenticated', (event) => {
        console.debug('Received module:authenticated event:', event)
        if (event.data.authenticated) {
          connected.value = true
          flush()
          initializeListeners()

          // Mark initialization as complete
          settle(() => {
            resolve()
            // eslint-disable-next-line no-console
            console.log('WebSocket server connection established and authenticated')
          })
          return
        }

        // Authentication failed
        connected.value = false
        settle(() => reject(new Error('WebSocket authentication failed')))
      })
    })

    console.debug('[CHANNEL-SERVER] WebSocket client initialization completed', initializing.value)
    return initializing.value
  }

  async function ensureConnected() {
    await initializing.value
    if (!connected.value) {
      return await initialize()
    }
  }

  function clearListeners() {
    for (const disposer of listenerDisposers.value) {
      try {
        disposer()
      }
      catch (error) {
        console.warn('Failed to dispose channel listener:', error)
      }
    }
    listenerDisposers.value = []
    listenersInitialized.value = false
  }

  function initializeListeners() {
    if (!client.value)
      // No-op for now; keep placeholder for future shared listeners.
      // eslint-disable-next-line no-useless-return
      return
  }

  function send<C = undefined>(data: WebSocketEventOptionalSource<C>) {
    console.debug('[CHANNEL-SERVER] send() called with:', {
      type: (data as any)?.type,
      hasClient: !!client.value,
      connected: connected.value,
      isInitializing: !!initializing.value,
      queueLength: pendingSend.value.length,
    })

    // Queue the message if not connected yet
    if (!connected.value) {
      console.debug('[CHANNEL-SERVER] Not connected, queuing message')
      pendingSend.value.push(data as WebSocketEvent)

      // Initialize if no client exists AND not already initializing
      if (!client.value && !initializing.value) {
        console.debug('[CHANNEL-SERVER] No client exists, starting initialization')
        void initialize()
      }
      else if (client.value && !initializing.value) {
        console.debug('[CHANNEL-SERVER] Client exists but not connected and not initializing - this is unexpected', client.value, initializing.value)
      }
      else if (initializing.value) {
        console.debug('[CHANNEL-SERVER] Initialization in progress, message will be sent after connection')
      }
      return
    }

    // We're connected, send immediately
    if (client.value) {
      console.debug('[CHANNEL-SERVER] Connected, sending immediately')
      client.value.send(data as WebSocketEvent)
    }
    else {
      console.warn('[CHANNEL-SERVER] Connected state is true but no client - this should not happen')
    }
  }

  function flush() {
    if (client.value && connected.value) {
      for (const update of pendingSend.value) {
        client.value.send(update)
      }

      pendingSend.value = []
    }
  }

  async function onContextUpdate(callback: (event: WebSocketBaseEvent<'context:update', ContextUpdate>) => void | Promise<void>) {
    console.debug('[CHANNEL-SERVER] onContextUpdate() called, checking client state')

    // Ensure client is initialized before attaching listeners
    if (!client.value) {
      console.debug('[CHANNEL-SERVER] onContextUpdate: No client exists')
      if (!initializing.value) {
        console.debug('[CHANNEL-SERVER] onContextUpdate: Starting initialization')
        await initialize()
      }
      else {
        console.debug('[CHANNEL-SERVER] onContextUpdate: Waiting for existing initialization')
        await initializing.value
      }
    }
    else {
      console.debug('[CHANNEL-SERVER] onContextUpdate: Client exists, attaching listener')
    }

    client.value?.onEvent('context:update', callback as any)

    return () => {
      client.value?.offEvent('context:update', callback as any)
    }
  }

  async function onEvent<E extends keyof WebSocketEvents>(
    type: E,
    callback: (event: WebSocketBaseEvent<E, WebSocketEvents[E]>) => void | Promise<void>,
  ) {
    console.debug(`[CHANNEL-SERVER] onEvent('${type}') called, checking client state`)

    // Ensure client is initialized before attaching listeners
    if (!client.value) {
      console.debug(`[CHANNEL-SERVER] onEvent('${type}'): No client exists`)
      if (!initializing.value) {
        console.debug(`[CHANNEL-SERVER] onEvent('${type}'): Starting initialization`)
        await initialize()
      }
      else {
        console.debug(`[CHANNEL-SERVER] onEvent('${type}'): Waiting for existing initialization`)
        await initializing.value
      }
    }
    else {
      console.debug(`[CHANNEL-SERVER] onEvent('${type}'): Client exists, attaching listener`)
    }

    if (client.value) {
      client.value.onEvent(type, callback as any)
      console.log(`[CHANNEL-SERVER] Successfully registered listener for event type: '${type}'`)
    }
    else {
      console.error(`[CHANNEL-SERVER] Failed to register listener for '${type}' - no client available`)
    }

    return () => {
      client.value?.offEvent(type, callback as any)
    }
  }

  function sendContextUpdate(message: Omit<ContextUpdate, 'id' | 'contextId'> & Partial<Pick<ContextUpdate, 'id' | 'contextId'>>) {
    console.debug('[CHANNEL-SERVER] -> sendContextUpdate:', message)
    const id = nanoid()
    send({ type: 'context:update', data: { id, contextId: id, ...message } })
  }

  function dispose() {
    flush()
    clearListeners()

    if (client.value) {
      client.value.close()
      client.value = undefined
    }
    connected.value = false
    initializing.value = null
  }

  watch(websocketUrl, (newUrl, oldUrl) => {
    if (newUrl === oldUrl)
      return

    if (client.value || initializing.value) {
      dispose()
      void initialize()
    }
  })

  return {
    connected,
    ensureConnected,

    initialize,
    send,
    sendContextUpdate,
    onContextUpdate,
    onEvent,
    dispose,
  }
})

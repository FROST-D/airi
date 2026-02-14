import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { nanoid } from 'nanoid'
import { defineStore, storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'

import { useChatOrchestratorStore } from '../chat'
import { useChatContextStore } from '../chat/context-store'
import { useChatSessionStore } from '../chat/session-store'
import { useMultilevelMemoryStore } from '../memory-multilevel'

// Global session ID for cross-session memory storage
const GLOBAL_MEMORY_SESSION_ID = 'global-memory-session'

/**
 * Memory Integration Module
 *
 * Automatically saves chat messages to memory-multilevel and retrieves
 * relevant context to inject into LLM conversations.
 */
export const useMemoryIntegrationStore = defineStore('memory-integration', () => {
  // Settings
  const enabled = useLocalStorageManualReset<boolean>('settings/memory-integration/enabled', true)
  const saveToL0 = useLocalStorageManualReset<boolean>('settings/memory-integration/save-to-l0', true)
  const saveToL1 = useLocalStorageManualReset<boolean>('settings/memory-integration/save-to-l1', true)
  const saveToL2 = useLocalStorageManualReset<boolean>('settings/memory-integration/save-to-l2', true)
  const retrieveFromL1 = useLocalStorageManualReset<boolean>('settings/memory-integration/retrieve-from-l1', true)
  const retrieveFromL2 = useLocalStorageManualReset<boolean>('settings/memory-integration/retrieve-from-l2', true)
  const contextMessagesLimit = useLocalStorageManualReset<number>('settings/memory-integration/context-limit', 3)
  const semanticSearchLimit = useLocalStorageManualReset<number>('settings/memory-integration/semantic-limit', 5)

  // State
  const isInitialized = ref(false)
  const lastError = ref<string | null>(null)
  const hookCleanups = ref<Array<() => void>>([])

  // Dependencies
  const memoryStore = useMultilevelMemoryStore()
  const chatOrchestrator = useChatOrchestratorStore()
  const chatContext = useChatContextStore()
  const chatSession = useChatSessionStore()
  const { activeSessionId } = storeToRefs(chatSession)

  // Computed
  const isMemoryInitialized = computed(() => memoryStore.initialized)
  const canUse = computed(() => enabled.value && isMemoryInitialized.value)

  /**
   * Initialize memory integration hooks
   */
  async function initialize() {
    if (isInitialized.value) {
      console.debug('[MemoryIntegration] Already initialized')
      return { success: true }
    }

    try {
      // Ensure memory system is initialized
      if (!memoryStore.initialized) {
        console.warn('[MemoryIntegration] Memory system not initialized, attempting to initialize...')
        await memoryStore.initialize()
      }

      // Hook into chat lifecycle
      setupChatHooks()

      isInitialized.value = true
      console.info('[MemoryIntegration] Initialized successfully')
      return { success: true }
    }
    catch (error) {
      lastError.value = error instanceof Error ? error.message : String(error)
      console.error('[MemoryIntegration] Failed to initialize:', error)
      return { success: false, error: lastError.value }
    }
  }

  /**
   * Setup chat lifecycle hooks
   */
  function setupChatHooks() {
    // Clean up existing hooks
    cleanup()

    // Hook: Before message composed - inject memory context
    hookCleanups.value.push(
      chatOrchestrator.onBeforeMessageComposed(async (message, context) => {
        if (!canUse.value)
          return

        try {
          // Provide fallback ID if message.id is undefined
          const messageId = context.message.id ?? nanoid()
          await injectMemoryContext(message, messageId)
        }
        catch (error) {
          console.error('[MemoryIntegration] Error injecting context:', error)
        }
      }),
    )

    // Hook: After send - save user message
    hookCleanups.value.push(
      chatOrchestrator.onAfterSend(async (message, context) => {
        if (!canUse.value)
          return

        try {
          await saveUserMessage(message, context)
        }
        catch (error) {
          console.error('[MemoryIntegration] Error saving user message:', error)
        }
      }),
    )

    // Hook: Chat turn complete - save assistant response + semantic chunk
    hookCleanups.value.push(
      chatOrchestrator.onChatTurnComplete(async (chat, context) => {
        if (!canUse.value)
          return

        try {
          await saveAssistantMessage(chat.outputText, context)

          // Save conversation exchange to L2 semantic memory
          if (saveToL2.value && memoryStore.l2Enabled) {
            await saveChatExchangeToL2(chat, context)
          }
        }
        catch (error) {
          console.error('[MemoryIntegration] Error saving assistant message:', error)
        }
      }),
    )

    console.debug('[MemoryIntegration] Chat hooks registered')
  }

  /**
   * Inject relevant memory context before LLM sees the message
   */
  async function injectMemoryContext(userMessage: string, messageId: string) {
    if (!canUse.value)
      return

    console.debug('[MemoryIntegration] Injecting memory context for:', userMessage.substring(0, 50))

    const contextParts: string[] = []

    // Retrieve from L1 (recent session messages)
    if (retrieveFromL1.value && memoryStore.l1Enabled) {
      try {
        const recentMessages = await memoryStore.l1SearchInSession(
          GLOBAL_MEMORY_SESSION_ID,
          userMessage,
          contextMessagesLimit.value,
        )

        if (recentMessages.length > 0) {
          const summary = recentMessages
            .map(msg => `[${msg.role}]: ${msg.content.substring(0, 100)}`)
            .join('\n')
          contextParts.push(`## Recent conversation context:\n${summary}`)
        }
      }
      catch (error) {
        console.warn('[MemoryIntegration] Failed to retrieve L1 context:', error)
      }
    }

    // Retrieve from L2 (semantic memory)
    if (retrieveFromL2.value && memoryStore.l2Enabled) {
      try {
        const semanticResults = await memoryStore.l2SearchHybrid(
          userMessage,
          { limit: semanticSearchLimit.value },
        )

        if (semanticResults.length > 0) {
          const summary = semanticResults
            .map((result, idx) => `${idx + 1}. ${result.chunk.content.substring(0, 150)}`)
            .join('\n')
          contextParts.push(`## Relevant knowledge from past conversations:\n${summary}`)
        }
      }
      catch (error) {
        console.warn('[MemoryIntegration] Failed to retrieve L2 context:', error)
      }
    }

    // Inject context if we found any
    if (contextParts.length > 0) {
      const contextMessage = contextParts.join('\n\n')
      const contextText = `# Memory Context\n\n${contextMessage}\n\nUse this context to provide more relevant and personalized responses.`

      chatContext.ingestContextMessage({
        id: nanoid(),
        contextId: `memory-context-${messageId}`,
        strategy: ContextUpdateStrategy.ReplaceSelf,
        text: contextText,
        metadata: {
          source: {
            id: 'memory-integration',
            kind: 'plugin',
            plugin: {
              id: 'memory-integration',
              version: '1.0.0',
            },
          },
        },
        createdAt: Date.now(),
      })

      console.debug('[MemoryIntegration] Injected context:', contextMessage.substring(0, 200))
    }
  }

  /**
   * Save user message to memory
   */
  async function saveUserMessage(message: string, context: any) {
    if (!canUse.value)
      return

    const timestamp = new Date()
    const messageObj = {
      role: 'user' as const,
      content: message,
      timestamp,
    }

    console.debug('[MemoryIntegration] Saving user message:', message.substring(0, 50))

    // Save to L0 (working set)
    if (saveToL0.value && memoryStore.l0Enabled) {
      try {
        await memoryStore.l0AddMessage(GLOBAL_MEMORY_SESSION_ID, messageObj)
      }
      catch (error) {
        console.warn('[MemoryIntegration] Failed to save to L0:', error)
      }
    }

    // Save to L1 (episodic memory)
    if (saveToL1.value && memoryStore.l1Enabled) {
      try {
        const l1Message = {
          messageId: context.message?.id || crypto.randomUUID(),
          sessionId: GLOBAL_MEMORY_SESSION_ID,
          userId: 'current-user', // TODO: Get from user profile
          role: 'user',
          content: message,
          timestamp,
          metadata: {
            source: 'chat',
            contextSources: Object.keys(context.contexts || {}),
            originalSessionId: activeSessionId.value,
          },
        }
        await memoryStore.l1AddMessage(l1Message)
        console.debug('[MemoryIntegration] ✅ Saved user message to L1 (global):', { sessionId: GLOBAL_MEMORY_SESSION_ID, messageId: l1Message.messageId, contentPreview: message.substring(0, 50) })
      }
      catch (error) {
        console.error('[MemoryIntegration] ❌ Failed to save user to L1:', error)
      }
    }
  }

  /**
   * Save assistant response to memory
   */
  async function saveAssistantMessage(message: string, context: any) {
    if (!canUse.value)
      return

    const timestamp = new Date()
    const messageObj = {
      role: 'assistant' as const,
      content: message,
      timestamp,
    }

    console.debug('[MemoryIntegration] Saving assistant message:', message.substring(0, 50))

    // Save to L0 (working set)
    if (saveToL0.value && memoryStore.l0Enabled) {
      try {
        await memoryStore.l0AddMessage(GLOBAL_MEMORY_SESSION_ID, messageObj)
      }
      catch (error) {
        console.warn('[MemoryIntegration] Failed to save assistant to L0:', error)
      }
    }

    // Save to L1 (episodic memory)
    if (saveToL1.value && memoryStore.l1Enabled) {
      try {
        const l1Message = {
          messageId: context.output?.id || crypto.randomUUID(),
          sessionId: GLOBAL_MEMORY_SESSION_ID,
          userId: 'current-user', // TODO: Get from user profile
          role: 'assistant',
          content: message,
          timestamp,
          metadata: {
            source: 'chat',
            hasToolCalls: (context.toolCalls?.length || 0) > 0,
            originalSessionId: activeSessionId.value,
          },
        }
        await memoryStore.l1AddMessage(l1Message)
        console.debug('[MemoryIntegration] ✅ Saved assistant message to L1 (global):', { sessionId: GLOBAL_MEMORY_SESSION_ID, messageId: l1Message.messageId, contentPreview: message.substring(0, 50), hasToolCalls: l1Message.metadata.hasToolCalls })
      }
      catch (error) {
        console.error('[MemoryIntegration] ❌ Failed to save assistant to L1:', error)
      }
    }
  }

  /**
   * Save chat exchange to L2 semantic memory
   */
  async function saveChatExchangeToL2(chat: any, context: any) {
    try {
      // Get the user message and assistant response
      const userMessage = context.message?.content || ''
      const assistantResponse = chat.outputText || ''

      if (!userMessage || !assistantResponse) {
        console.debug('[MemoryIntegration] Skipping L2 save - missing message content', { userMessage: !!userMessage, assistantResponse: !!assistantResponse })
        return
      }

      // Create a chunk from the conversation exchange
      const exchangeText = `User: ${userMessage}\n\nAssistant: ${assistantResponse}`
      const chunkId = `chat-${activeSessionId.value}-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`

      await memoryStore.l2AddChunk({
        chunkId,
        content: exchangeText,
        source: 'chat',
        sourceId: activeSessionId.value,
        tenantId: 'default',
        timestamp: new Date(),
        metadata: {
          sessionId: activeSessionId.value,
          hasToolCalls: (context.toolCalls?.length || 0) > 0,
          messageIds: {
            user: context.message?.id,
            assistant: chat.output?.id,
          },
        },
      })

      console.debug('[MemoryIntegration] ✅ Saved chat exchange to L2:', {
        sessionId: activeSessionId.value,
        chunkId,
        contentPreview: exchangeText.substring(0, 100),
        hasToolCalls: (context.toolCalls?.length || 0) > 0,
      })
    }
    catch (error) {
      console.warn('[MemoryIntegration] Failed to save to L2:', error)
    }
  }

  /**
   * Cleanup hooks
   */
  function cleanup() {
    hookCleanups.value.forEach(cleanup => cleanup())
    hookCleanups.value = []
  }

  /**
   * Disable and cleanup
   */
  function disable() {
    cleanup()
    isInitialized.value = false
    enabled.value = false
    console.info('[MemoryIntegration] Disabled')
  }

  // Auto-initialize when memory system becomes available
  watch(isMemoryInitialized, async (initialized) => {
    if (initialized && enabled.value && !isInitialized.value) {
      console.debug('[MemoryIntegration] Memory system initialized, auto-initializing integration')
      await initialize()
    }
  })

  // Auto-initialize on enable
  watch(enabled, async (isEnabled) => {
    if (isEnabled && isMemoryInitialized.value && !isInitialized.value) {
      console.debug('[MemoryIntegration] Enabled, auto-initializing')
      await initialize()
    }
    else if (!isEnabled && isInitialized.value) {
      disable()
    }
  })

  return {
    // State
    enabled,
    saveToL0,
    saveToL1,
    saveToL2,
    retrieveFromL1,
    retrieveFromL2,
    contextMessagesLimit,
    semanticSearchLimit,
    isInitialized,
    lastError,
    canUse,

    // Actions
    initialize,
    disable,
    cleanup,
  }
})

import type { ChatProvider } from '@xsai-ext/providers/utils'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { useIntervalFn, useTimestamp } from '@vueuse/core'
import { defineStore, storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'

import { useChatOrchestratorStore } from '../chat'
import { useProvidersStore } from '../providers'
import { useConsciousnessStore } from './consciousness'
import { useHearingStore } from './hearing'
import { useSpeechStore } from './speech'

export const useAutoCommentsStore = defineStore('auto-comments', () => {
  // Settings
  const enabled = useLocalStorageManualReset<boolean>('settings/auto-comments/enabled', false)
  const idleThresholdMs = useLocalStorageManualReset<number>('settings/auto-comments/idle-threshold-ms', 300000) // 5 minutes default
  const checkIntervalMs = useLocalStorageManualReset<number>('settings/auto-comments/check-interval-ms', 60000) // 1 minute default

  // Snooze state
  const snoozedUntil = ref<number>(0)
  const defaultSnoozeDurationMs = useLocalStorageManualReset<number>('settings/auto-comments/default-snooze-duration-ms', 1800000) // 30 minutes default

  // Activity tracking
  const lastUserActivityTime = ref<number>(Date.now())
  const lastContextChange = ref<number>(Date.now())
  const lastAutoCommentTime = ref<number>(0)

  // Current timestamp (reactive)
  const currentTime = useTimestamp({ interval: 1000 })

  // Computed states
  const isSnoozed = computed(() => currentTime.value < snoozedUntil.value)
  const snoozeTimeRemaining = computed(() => Math.max(0, snoozedUntil.value - currentTime.value))

  const timeSinceLastActivity = computed(() => currentTime.value - lastUserActivityTime.value)
  const isUserIdle = computed(() => timeSinceLastActivity.value >= idleThresholdMs.value)

  // Dependencies
  const chatOrchestrator = useChatOrchestratorStore()
  const consciousnessStore = useConsciousnessStore()
  const providersStore = useProvidersStore()
  const hearingStore = useHearingStore()
  const speechStore = useSpeechStore()

  const { configured: consciousnessConfigured } = storeToRefs(consciousnessStore)
  const { activeProvider, activeModel } = storeToRefs(consciousnessStore)

  const shouldTriggerComment = computed(() => {
    return enabled.value
      && consciousnessConfigured.value
      && !isSnoozed.value
      && isUserIdle.value
      && lastContextChange.value > lastAutoCommentTime.value
  })

  // Watch for user activity
  const { sending } = storeToRefs(chatOrchestrator)
  watch(sending, (value) => {
    if (value) {
      updateUserActivity('chat')
    }
  })

  // Functions
  function updateUserActivity(source: 'chat' | 'voice' | 'manual') {
    lastUserActivityTime.value = Date.now()
    console.debug('[AutoComments] User activity detected:', source)
  }

  function updateContextChange(description?: string) {
    lastContextChange.value = Date.now()
    console.debug('[AutoComments] Context change detected:', description)
  }

  function snooze(durationMs?: number) {
    const duration = durationMs ?? defaultSnoozeDurationMs.value
    snoozedUntil.value = Date.now() + duration
    console.info('[AutoComments] Snoozed for', duration / 1000, 'seconds')
  }

  function snoozeFor(minutes: number) {
    snooze(minutes * 60 * 1000)
  }

  function unsnooze() {
    snoozedUntil.value = 0
    console.info('[AutoComments] Unsnooze d')
  }

  function parseSnoozeCommand(text: string): number | null {
    // Match patterns like "snooze for 30 minutes", "snooze 1 hour", "snooze 15min", etc.
    const patterns = [
      /snooze\s+(?:for\s+)?(\d+)\s*(?:minute|min|m)s?/i,
      /snooze\s+(?:for\s+)?(\d+)\s*(?:hour|hr|h)s?/i,
      /snooze\s+(?:for\s+)?(\d+)/i, // Default to minutes
    ]

    for (const pattern of patterns) {
      const match = text.match(pattern)
      if (match) {
        const value = Number.parseInt(match[1])
        if (pattern.source.includes('hour')) {
          return value * 60 * 60 * 1000
        }
        return value * 60 * 1000 // Default to minutes
      }
    }

    // Check for simple "snooze" command
    if (/\bsnooze\b/i.test(text)) {
      return defaultSnoozeDurationMs.value
    }

    return null
  }

  async function triggerAutoComment() {
    if (!shouldTriggerComment.value)
      return

    if (!consciousnessConfigured.value) {
      console.warn('[AutoComments] Cannot trigger: Consciousness module not configured (no active provider/model)')
      return
    }

    try {
      lastAutoCommentTime.value = Date.now()

      // Get the active provider instance
      const chatProvider = await providersStore.getProviderInstance(activeProvider.value) as ChatProvider
      if (!chatProvider) {
        console.error('[AutoComments] Failed to get provider instance for:', activeProvider.value)
        return
      }

      const providerConfig = providersStore.getProviderConfig(activeProvider.value)

      // Create a context-aware comment
      // TODO: Integrate with consciousness/context providers for rich comments
      const comment = generateContextComment()

      console.info('[AutoComments] Triggering auto-comment:', comment)

      // Ingest the comment into the chat with proper SendOptions
      await chatOrchestrator.ingest(comment, {
        model: activeModel.value,
        chatProvider,
        providerConfig,
      })
    }
    catch (error) {
      console.error('[AutoComments] Failed to trigger auto-comment:', error)
    }
  }

  function generateContextComment(): string {
    // NOTICE: Basic implementation - can be enhanced with context providers
    const idleMinutes = Math.floor(timeSinceLastActivity.value / 60000)

    const comments = [
      `I noticed you've been away for ${idleMinutes} minutes. Is everything okay?`,
      `It's been ${idleMinutes} minutes since we last talked. Need any help?`,
      `Hey! You've been idle for a while. Want to catch up?`,
      `I see ${idleMinutes} minutes have passed. Anything interesting happening?`,
    ]

    return comments[Math.floor(Math.random() * comments.length)]
  }

  // Interval to check for auto-comment triggers
  const { pause: pauseAutoCommentCheck, resume: resumeAutoCommentCheck } = useIntervalFn(
    () => {
      if (shouldTriggerComment.value) {
        triggerAutoComment()
      }
    },
    checkIntervalMs,
    { immediate: false },
  )

  // Auto-start/stop based on enabled state
  watch(enabled, (isEnabled) => {
    if (isEnabled) {
      resumeAutoCommentCheck()
    }
    else {
      pauseAutoCommentCheck()
    }
  }, { immediate: true })

  // Listen to chat hooks to detect user messages
  chatOrchestrator.onBeforeSend(() => {
    updateUserActivity('chat')
  })

  // Parse snooze commands from user messages
  chatOrchestrator.onBeforeSend((message) => {
    const snoozeDuration = parseSnoozeCommand(message)
    if (snoozeDuration !== null) {
      snooze(snoozeDuration)
    }

    // Check for unsnooze command
    if (/\bunsnooze\b/i.test(message)) {
      unsnooze()
    }
  })

  return {
    // Settings
    enabled,
    idleThresholdMs,
    checkIntervalMs,
    defaultSnoozeDurationMs,

    // State
    snoozedUntil,
    lastUserActivityTime,
    lastContextChange,
    lastAutoCommentTime,

    // Computed
    isSnoozed,
    snoozeTimeRemaining,
    timeSinceLastActivity,
    isUserIdle,
    shouldTriggerComment,

    // Methods
    updateUserActivity,
    updateContextChange,
    snooze,
    snoozeFor,
    unsnooze,
    parseSnoozeCommand,
    triggerAutoComment,
    pauseAutoCommentCheck,
    resumeAutoCommentCheck,
  }
})

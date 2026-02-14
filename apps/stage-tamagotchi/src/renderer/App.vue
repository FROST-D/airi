<script setup lang="ts">
import { defineInvoke, defineInvokeHandler } from '@moeru/eventa'
import { themeColorFromValue, useThemeColor } from '@proj-airi/stage-layouts/composables/theme-color'
import { ToasterRoot } from '@proj-airi/stage-ui/components'
import { useSharedAnalyticsStore } from '@proj-airi/stage-ui/stores/analytics'
import { useCharacterOrchestratorStore } from '@proj-airi/stage-ui/stores/character'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { useModsServerChannelStore } from '@proj-airi/stage-ui/stores/mods/api/channel-server'
import { useContextBridgeStore } from '@proj-airi/stage-ui/stores/mods/api/context-bridge'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useMemoryIntegrationStore } from '@proj-airi/stage-ui/stores/modules/memory-integration'
import { useOnboardingStore } from '@proj-airi/stage-ui/stores/onboarding'
import { usePerfTracerBridgeStore } from '@proj-airi/stage-ui/stores/perf-tracer-bridge'
import { useSettings } from '@proj-airi/stage-ui/stores/settings'
import { useTheme } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { toast, Toaster } from 'vue-sonner'

import ResizeHandler from './components/ResizeHandler.vue'

import { electronOpenSettings, electronStartTrackMousePosition, electronStartWebSocketServer } from '../shared/eventa'
import { useElectronEventaContext, useElectronEventaInvoke } from './composables/electron-vueuse'

const { isDark: dark } = useTheme()
const i18n = useI18n()
const contextBridgeStore = useContextBridgeStore()
const displayModelsStore = useDisplayModelsStore()
const settingsStore = useSettings()
const { language, themeColorsHue, themeColorsHueDynamic } = storeToRefs(settingsStore)
const onboardingStore = useOnboardingStore()
const router = useRouter()
const route = useRoute()
const cardStore = useAiriCardStore()
const memoryIntegrationStore = useMemoryIntegrationStore()
const chatSessionStore = useChatSessionStore()
const serverChannelStore = useModsServerChannelStore()
const characterOrchestratorStore = useCharacterOrchestratorStore()
const analyticsStore = useSharedAnalyticsStore()
usePerfTracerBridgeStore()

watch(language, () => {
  i18n.locale.value = language.value
})

const { updateThemeColor } = useThemeColor(themeColorFromValue({ light: 'rgb(255 255 255)', dark: 'rgb(18 18 18)' }))
watch(dark, () => updateThemeColor(), { immediate: true })
watch(route, () => updateThemeColor(), { immediate: true })
onMounted(() => updateThemeColor())

const startWebSocketServer = useElectronEventaInvoke(electronStartWebSocketServer)

onMounted(async () => {
  console.debug('[StageTamagotchi->App.vue] mounted - initializing stores')
  analyticsStore.initialize()
  console.debug(' [StageTamagotchi->App.vue] Analytics store initialized')
  cardStore.initialize()

  // Initialize memory integration (will auto-init when memory system is ready)
  if (memoryIntegrationStore.enabled) {
    memoryIntegrationStore.initialize().catch(err =>
      console.warn('[StageTamagotchi->App.vue] Memory integration initialization deferred or failed:', err),
    )
    console.debug(' [StageTamagotchi->App.vue] Memory Integration store initialization started')
  }

  console.debug(' [StageTamagotchi->App.vue] Airi Card store initialized')
  onboardingStore.initializeSetupCheck()
  console.debug(' [StageTamagotchi->App.vue] Onboarding store initialized')

  await chatSessionStore.initialize()
  console.debug(' [StageTamagotchi->App.vue] Chat Session store initialized')
  await displayModelsStore.loadDisplayModelsFromIndexedDB()
  console.debug(' [StageTamagotchi->App.vue] Display Models store initialized')
  await settingsStore.initializeStageModel()
  console.debug(' [StageTamagotchi->App.vue] Settings store initialized')

  console.debug(' [StageTamagotchi->App.vue] Starting WebSocket server...')
  let startWebSocketServerResult
  const maxRetries = 5
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.debug(` [StageTamagotchi->App.vue] WebSocket server start attempt ${attempt}/${maxRetries}`)
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('WebSocket server start timeout after 10s')), 2000),
      )
      startWebSocketServerResult = await Promise.race([
        startWebSocketServer({ websocketSecureEnabled: settingsStore.websocketSecureEnabled }),
        timeoutPromise,
      ])
      console.debug(' [StageTamagotchi->App.vue] WebSocket server started successfully with result:', startWebSocketServerResult)
      break // Success, exit retry loop
    }
    catch (error) {
      console.error(` [StageTamagotchi->App.vue] Failed to start WebSocket server (attempt ${attempt}/${maxRetries}):`, error)
      if (attempt === maxRetries) {
        console.error(' [StageTamagotchi->App.vue] All WebSocket server start attempts failed')
        // Continue with initialization even if WebSocket server fails
      }
      // Add a small delay between retries
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
  }

  console.debug(' [StageTamagotchi->App.vue] Initializing Mods Server Channel')
  await serverChannelStore.initialize({ possibleEvents: ['ui:configure'] }).catch(err => console.error('Failed to initialize Mods Server Channel in App.vue:', err))
  console.debug(' [StageTamagotchi->App.vue] Mods Server Channel initialized successfully')
  await contextBridgeStore.initialize()
  characterOrchestratorStore.initialize()

  const context = useElectronEventaContext()
  const startTrackingCursorPoint = defineInvoke(context.value, electronStartTrackMousePosition)
  await startTrackingCursorPoint()

  // Listen for open-settings IPC message from main process
  defineInvokeHandler(context.value, electronOpenSettings, () => router.push('/settings'))
})

watch(themeColorsHue, () => {
  document.documentElement.style.setProperty('--chromatic-hue', themeColorsHue.value.toString())
}, { immediate: true })

watch(themeColorsHueDynamic, () => {
  document.documentElement.classList.toggle('dynamic-hue', themeColorsHueDynamic.value)
}, { immediate: true })

onUnmounted(() => contextBridgeStore.dispose())
</script>

<template>
  <ToasterRoot @close="id => toast.dismiss(id)">
    <Toaster />
  </ToasterRoot>
  <ResizeHandler />
  <RouterView />
</template>

<style>
/* We need this to properly animate the CSS variable */
@property --chromatic-hue {
  syntax: '<number>';
  initial-value: 0;
  inherits: true;
}

@keyframes hue-anim {
  from {
    --chromatic-hue: 0;
  }
  to {
    --chromatic-hue: 360;
  }
}

.dynamic-hue {
  animation: hue-anim 10s linear infinite;
}
</style>

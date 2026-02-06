<script setup lang="ts">
import { Alert } from '@proj-airi/stage-ui/components'
import { useAutoCommentsStore } from '@proj-airi/stage-ui/stores/modules'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

const autoCommentsStore = useAutoCommentsStore()
const consciousnessStore = useConsciousnessStore()
const { configured: consciousnessConfigured } = storeToRefs(consciousnessStore)

const {
  enabled,
  idleThresholdMs,
  checkIntervalMs,
  defaultSnoozeDurationMs,
  isSnoozed,
  snoozeTimeRemaining,
  timeSinceLastActivity,
  isUserIdle,
} = storeToRefs(autoCommentsStore)

const { t } = useI18n()

const idleThresholdMinutes = computed({
  get: () => Math.floor(idleThresholdMs.value / 60000),
  set: (value) => { idleThresholdMs.value = value * 60000 },
})

const checkIntervalMinutes = computed({
  get: () => Math.floor(checkIntervalMs.value / 60000),
  set: (value) => { checkIntervalMs.value = value * 60000 },
})

const defaultSnoozeDurationMinutes = computed({
  get: () => Math.floor(defaultSnoozeDurationMs.value / 60000),
  set: (value) => { defaultSnoozeDurationMs.value = value * 60000 },
})

function formatTime(ms: number) {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60)
    return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60)
    return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}
</script>

<template>
  <div :class="['flex', 'flex-col', 'gap-4']">
    <!-- Header -->
    <div>
      <h1 :class="['text-3xl', 'font-bold', 'text-neutral-800', 'dark:text-neutral-100']">
        Auto-Comments
      </h1>
      <p :class="['mt-2', 'text-neutral-600', 'dark:text-neutral-400']">
        Configure automatic context-aware comments when you're idle. AIRI will proactively comment on context changes after a period of inactivity.
      </p>
    </div>

    <!-- Consciousness Not Configured Warning -->
    <Alert v-if="!consciousnessConfigured" type="warning">
      <template #title>
        Consciousness Module Not Configured
      </template>
      <p>Auto-comments require the Consciousness module to be configured with an active provider and model.</p>
      <p :class="['mt-2']">
        Please visit <RouterLink to="/settings/modules/consciousness" :class="['underline', 'font-medium']">
          Consciousness settings
        </RouterLink> to configure a chat provider first.
      </p>
    </Alert>

    <!-- Enable/Disable Toggle -->
    <div :class="['bg-neutral-50', 'dark:bg-neutral-800/30', 'rounded-xl', 'p-4']">
      <div :class="['flex', 'items-center', 'justify-between']">
        <div>
          <h3 :class="['text-lg', 'font-semibold', 'text-neutral-800', 'dark:text-neutral-100']">
            Enable Auto-Comments
          </h3>
          <p :class="['text-sm', 'text-neutral-600', 'dark:text-neutral-400']">
            Allow AIRI to automatically comment when idle
          </p>
        </div>
        <label :class="['relative', 'inline-flex', 'cursor-pointer', 'items-center']">
          <input
            v-model="enabled"
            type="checkbox"
            :class="['sr-only', 'peer']"
          >
          <div :class="['peer', 'h-6', 'w-11', 'rounded-full', 'bg-neutral-300', 'dark:bg-neutral-600', 'peer-checked:bg-primary-500', 'peer-focus:ring-4', 'peer-focus:ring-primary-300', 'dark:peer-focus:ring-primary-800', 'transition-colors']">
            <div :class="['absolute', 'left-0.5', 'top-0.5', 'h-5', 'w-5', 'rounded-full', 'bg-white', 'transition-transform', 'peer-checked:translate-x-5']" />
          </div>
        </label>
      </div>
    </div>

    <!-- Status Info -->
    <div v-if="enabled" :class="['grid', 'gap-4', 'md:grid-cols-3']">
      <div :class="['bg-neutral-50', 'dark:bg-neutral-800/30', 'rounded-xl', 'p-4']">
        <h3 :class="['text-sm', 'font-semibold', 'text-neutral-600', 'dark:text-neutral-400', 'mb-2']">
          Activity Status
        </h3>
        <div :class="['flex', 'items-center', 'gap-2']">
          <div :class="['h-3', 'w-3', 'rounded-full', isUserIdle ? 'bg-amber-500' : 'bg-emerald-500']" />
          <span :class="['text-neutral-800', 'dark:text-neutral-100']">
            {{ isUserIdle ? 'Idle' : 'Active' }}
          </span>
        </div>
        <p :class="['mt-2', 'text-sm', 'text-neutral-600', 'dark:text-neutral-400']">
          Last activity: {{ formatTime(timeSinceLastActivity) }} ago
        </p>
      </div>

      <div :class="['bg-neutral-50', 'dark:bg-neutral-800/30', 'rounded-xl', 'p-4']">
        <h3 :class="['text-sm', 'font-semibold', 'text-neutral-600', 'dark:text-neutral-400', 'mb-2']">
          Snooze Status
        </h3>
        <div :class="['flex', 'items-center', 'gap-2']">
          <div :class="['h-3', 'w-3', 'rounded-full', isSnoozed ? 'bg-blue-500' : 'bg-neutral-300']" />
          <span :class="['text-neutral-800', 'dark:text-neutral-100']">
            {{ isSnoozed ? 'Snoozed' : 'Not Snoozed' }}
          </span>
        </div>
        <p v-if="isSnoozed" :class="['mt-2', 'text-sm', 'text-neutral-600', 'dark:text-neutral-400']">
          Remaining: {{ formatTime(snoozeTimeRemaining) }}
        </p>
        <div v-if="isSnoozed" :class="['mt-3']">
          <button
            type="button"
            :class="['px-3', 'py-1.5', 'text-sm', 'rounded-lg', 'bg-blue-500', 'text-white', 'hover:bg-blue-600', 'transition-colors']"
            @click="autoCommentsStore.unsnooze()"
          >
            Unsnooze Now
          </button>
        </div>
      </div>

      <div :class="['bg-neutral-50', 'dark:bg-neutral-800/30', 'rounded-xl', 'p-4']">
        <h3 :class="['text-sm', 'font-semibold', 'text-neutral-600', 'dark:text-neutral-400', 'mb-2']">
          System Status
        </h3>
        <div :class="['flex', 'items-center', 'gap-2']">
          <div :class="['h-3', 'w-3', 'rounded-full', consciousnessConfigured ? 'bg-emerald-500' : 'bg-red-500']" />
          <span :class="['text-neutral-800', 'dark:text-neutral-100']">
            {{ consciousnessConfigured ? 'Ready' : 'Not Ready' }}
          </span>
        </div>
        <p :class="['mt-2', 'text-sm', 'text-neutral-600', 'dark:text-neutral-400']">
          {{ consciousnessConfigured ? 'Consciousness configured' : 'Consciousness not configured' }}
        </p>
      </div>
    </div>

    <!-- Settings -->
    <div v-if="enabled" :class="['bg-neutral-50', 'dark:bg-neutral-800/30', 'rounded-xl', 'p-4', 'space-y-4']">
      <h3 :class="['text-lg', 'font-semibold', 'text-neutral-800', 'dark:text-neutral-100']">
        Settings
      </h3>

      <!-- Idle Threshold -->
      <div>
        <label :class="['block', 'text-sm', 'font-medium', 'text-neutral-700', 'dark:text-neutral-300', 'mb-2']">
          Idle Threshold (minutes)
        </label>
        <input
          v-model.number="idleThresholdMinutes"
          type="number"
          min="1"
          max="120"
          :class="['w-full', 'md:w-64', 'px-3', 'py-2', 'rounded-lg', 'border', 'border-neutral-300', 'dark:border-neutral-600', 'bg-white', 'dark:bg-neutral-800', 'text-neutral-800', 'dark:text-neutral-100', 'focus:ring-2', 'focus:ring-primary-500', 'focus:border-transparent']"
        >
        <p :class="['mt-1', 'text-xs', 'text-neutral-600', 'dark:text-neutral-400']">
          Time of inactivity before triggering auto-comments
        </p>
      </div>

      <!-- Check Interval -->
      <div>
        <label :class="['block', 'text-sm', 'font-medium', 'text-neutral-700', 'dark:text-neutral-300', 'mb-2']">
          Check Interval (minutes)
        </label>
        <input
          v-model.number="checkIntervalMinutes"
          type="number"
          min="1"
          max="60"
          :class="['w-full', 'md:w-64', 'px-3', 'py-2', 'rounded-lg', 'border', 'border-neutral-300', 'dark:border-neutral-600', 'bg-white', 'dark:bg-neutral-800', 'text-neutral-800', 'dark:text-neutral-100', 'focus:ring-2', 'focus:ring-primary-500', 'focus:border-transparent']"
        >
        <p :class="['mt-1', 'text-xs', 'text-neutral-600', 'dark:text-neutral-400']">
          How often to check for trigger conditions
        </p>
      </div>

      <!-- Default Snooze Duration -->
      <div>
        <label :class="['block', 'text-sm', 'font-medium', 'text-neutral-700', 'dark:text-neutral-300', 'mb-2']">
          Default Snooze Duration (minutes)
        </label>
        <input
          v-model.number="defaultSnoozeDurationMinutes"
          type="number"
          min="5"
          max="240"
          :class="['w-full', 'md:w-64', 'px-3', 'py-2', 'rounded-lg', 'border', 'border-neutral-300', 'dark:border-neutral-600', 'bg-white', 'dark:bg-neutral-800', 'text-neutral-800', 'dark:text-neutral-100', 'focus:ring-2', 'focus:ring-primary-500', 'focus:border-transparent']"
        >
        <p :class="['mt-1', 'text-xs', 'text-neutral-600', 'dark:text-neutral-400']">
          Default duration when snoozed via command
        </p>
      </div>
    </div>

    <!-- Usage Instructions -->
    <Alert v-if="enabled" type="info">
      <template #title>
        Voice/Chat Commands
      </template>
      <div :class="['space-y-2', 'text-sm']">
        <p>You can control snooze via chat or voice commands:</p>
        <ul :class="['list-disc', 'list-inside', 'space-y-1', 'ml-2']">
          <li><code :class="['px-1', 'py-0.5', 'rounded', 'bg-neutral-200', 'dark:bg-neutral-700']">snooze</code> - Snooze for default duration</li>
          <li><code :class="['px-1', 'py-0.5', 'rounded', 'bg-neutral-200', 'dark:bg-neutral-700']">snooze for 30 minutes</code> - Snooze for specific time</li>
          <li><code :class="['px-1', 'py-0.5', 'rounded', 'bg-neutral-200', 'dark:bg-neutral-700']">snooze 1 hour</code> - Snooze for 1 hour</li>
          <li><code :class="['px-1', 'py-0.5', 'rounded', 'bg-neutral-200', 'dark:bg-neutral-700']">unsnooze</code> - Cancel snooze immediately</li>
        </ul>
      </div>
    </Alert>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: Auto-Comments
  subtitleKey: settings.title
  descriptionKey: Configure automatic context-aware comments
  icon: i-solar:chat-round-line-bold-duotone
  settingsEntry: true
</route>

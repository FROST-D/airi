<script setup lang="ts">
import { useMultilevelMemoryStore } from '@proj-airi/stage-ui/stores/memory-multilevel'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const memoryStore = useMultilevelMemoryStore()
const { t } = useI18n()

const {
  enabled,
  initialized,
  initializationLoading,
  initializationError,
  isConfigured,
  // L0
  l0Enabled,
  l0Storage,
  l0RedisUrl,
  l0MaxMessages,
  l0MaxTokens,
  l0KeyPrefix,
  // L1
  l1Enabled,
  l1Storage,
  l1RedisUrl,
  l1PostgresUrl,
  l1SessionTtl,
  l1KeyPrefix,
  l1TableName,
  // L2
  l2Enabled,
  l2PostgresUrl,
  l2TableName,
  l2EmbeddingModel,
  l2OpenaiApiKey,
  l2OpenaiBaseUrl,
  l2UseHybridSearch,
  // L3
  l3Enabled,
  l3PostgresUrl,
  l3TableName,
  l3EmbeddingModel,
  l3OpenaiApiKey,
  l3OpenaiBaseUrl,
  l3UseHybridSearch,
} = storeToRefs(memoryStore)

const isSaving = ref(false)
const saveSuccess = ref(false)
const saveError = ref<string | null>(null)

const l0StatusColor = computed(() => l0Enabled.value ? 'text-green-600 dark:text-green-400' : 'text-neutral-400 dark:text-neutral-600')
const l1StatusColor = computed(() => l1Enabled.value ? 'text-green-600 dark:text-green-400' : 'text-neutral-400 dark:text-neutral-600')
const l2StatusColor = computed(() => l2Enabled.value && l2PostgresUrl.value && l2OpenaiApiKey.value ? 'text-green-600 dark:text-green-400' : l2Enabled.value ? 'text-orange-600 dark:text-orange-400' : 'text-neutral-400 dark:text-neutral-600')
const l3StatusColor = computed(() => l3Enabled.value && l3PostgresUrl.value && l3OpenaiApiKey.value ? 'text-green-600 dark:text-green-400' : l3Enabled.value ? 'text-orange-600 dark:text-orange-400' : 'text-neutral-400 dark:text-neutral-600')

const l0StatusText = computed(() => l0Enabled.value ? t('common.enabled', 'Enabled') : t('common.disabled', 'Disabled'))
const l1StatusText = computed(() => l1Enabled.value ? t('common.enabled', 'Enabled') : t('common.disabled', 'Disabled'))
const l2StatusText = computed(() => {
  if (!l2Enabled.value)
    return t('common.disabled', 'Disabled')
  if (!l2PostgresUrl.value || !l2OpenaiApiKey.value)
    return t('common.incomplete', 'Incomplete')
  return t('common.enabled', 'Enabled')
})
const l3StatusText = computed(() => {
  if (!l3Enabled.value)
    return t('common.disabled', 'Disabled')
  if (!l3PostgresUrl.value || !l3OpenaiApiKey.value)
    return t('common.incomplete', 'Incomplete')
  return t('common.enabled', 'Enabled')
})

async function initializeMemory() {
  if (!enabled.value) {
    saveError.value = 'Multilevel memory is disabled. Enable it first.'
    return
  }

  if (!isConfigured.value) {
    saveError.value = 'Configuration incomplete. At least L0 and L1 must be configured.'
    return
  }

  // Check L2 configuration if enabled
  if (l2Enabled.value) {
    if (!l2PostgresUrl.value) {
      saveError.value = 'L2 is enabled but PostgreSQL URL is missing'
      return
    }
    if (!l2OpenaiApiKey.value) {
      saveError.value = 'L2 is enabled but OpenAI API Key is missing'
      return
    }
    if (!l2EmbeddingModel.value) {
      saveError.value = 'L2 is enabled but Embedding Model is missing'
      return
    }
  }

  isSaving.value = true
  saveError.value = null
  saveSuccess.value = false

  try {
    await memoryStore.initialize()
    saveSuccess.value = true
    setTimeout(() => {
      saveSuccess.value = false
    }, 3000)
  }
  catch (error) {
    saveError.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    isSaving.value = false
  }
}

function resetMemory() {
  memoryStore.reset()
}
</script>

<template>
  <div :class="['space-y-6']">
    <!-- Master Enable -->
    <section :class="['border', 'border-neutral-200', 'rounded-xl', 'bg-white/80', 'p-4', 'shadow-sm', 'dark:border-neutral-800', 'dark:bg-neutral-900/60']">
      <header :class="['space-y-1']">
        <h1 :class="['text-xl', 'text-neutral-800', 'font-semibold', 'dark:text-neutral-100']">
          {{ t('settings.memory.multilevel.title', 'Multilevel Memory System') }}
        </h1>
        <p :class="['text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
          {{ t('settings.memory.multilevel.description', '4-level memory architecture: L0 (Working Set), L1 (Episodic), L2 (Semantic), L3 (Knowledge Base)') }}
        </p>
      </header>

      <div :class="['mt-4', 'space-y-4']">
        <!-- Enable/Disable -->
        <div :class="['flex', 'items-center', 'justify-between']">
          <span :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
            {{ t('settings.memory.multilevel.enabled', 'Enable Multilevel Memory') }}
          </span>
          <label :class="['relative', 'inline-flex', 'items-center', 'cursor-pointer']">
            <input v-model="enabled" type="checkbox" :class="['sr-only', 'peer']">
            <div :class="['w-11', 'h-6', 'bg-neutral-200', 'peer-focus:outline-none', 'peer-focus:ring-4', 'peer-focus:ring-primary-300', 'rounded-full', 'peer', 'dark:bg-neutral-700', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', 'after:content-[\'\']', 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-neutral-300', 'after:border', 'after:rounded-full', 'after:h-5', 'after:w-5', 'after:transition-all', 'dark:border-neutral-600', 'peer-checked:bg-primary-600']" />
          </label>
        </div>

        <!-- Status Card -->
        <div v-if="enabled" :class="['border', 'border-blue-200', 'rounded-lg', 'bg-blue-50', 'px-4', 'py-3', 'dark:border-blue-800', 'dark:bg-blue-900/30']">
          <div :class="['flex', 'items-center', 'justify-between']">
            <span :class="['text-sm', 'text-blue-800', 'font-medium', 'dark:text-blue-200']">
              {{ t('settings.memory.multilevel.status', 'Status') }}
            </span>
            <span v-if="initialized" :class="['text-sm', 'text-green-600', 'font-semibold', 'dark:text-green-400']">
              ● {{ t('common.initialized', 'Initialized') }}
            </span>
            <span v-else :class="['text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
              ○ {{ t('common.not_initialized', 'Not Initialized') }}
            </span>
          </div>
          <p v-if="initializationError" :class="['mt-2', 'text-xs', 'text-red-600', 'dark:text-red-400']">
            {{ initializationError }}
          </p>
        </div>

        <!-- Levels Overview -->
        <div v-if="enabled" :class="['grid', 'grid-cols-2', 'gap-3']">
          <!-- L0 -->
          <div :class="['border', 'border-neutral-200', 'rounded-lg', 'bg-neutral-50', 'p-3', 'dark:border-neutral-700', 'dark:bg-neutral-800/50']">
            <div :class="['flex', 'items-center', 'justify-between']">
              <span :class="['text-xs', 'text-neutral-500', 'uppercase', 'font-semibold', 'dark:text-neutral-400']">L0 Working Set</span>
              <span :class="[l0StatusColor, 'text-xs', 'font-medium']">{{ l0StatusText }}</span>
            </div>
            <p :class="['mt-1', 'text-xs', 'text-neutral-600', 'dark:text-neutral-400']">
              {{ t('settings.memory.multilevel.l0.desc', '6-12 recent messages') }}
            </p>
          </div>

          <!-- L1 -->
          <div :class="['border', 'border-neutral-200', 'rounded-lg', 'bg-neutral-50', 'p-3', 'dark:border-neutral-700', 'dark:bg-neutral-800/50']">
            <div :class="['flex', 'items-center', 'justify-between']">
              <span :class="['text-xs', 'text-neutral-500', 'uppercase', 'font-semibold', 'dark:text-neutral-400']">L1 Episodic</span>
              <span :class="[l1StatusColor, 'text-xs', 'font-medium']">{{ l1StatusText }}</span>
            </div>
            <p :class="['mt-1', 'text-xs', 'text-neutral-600', 'dark:text-neutral-400']">
              {{ t('settings.memory.multilevel.l1.desc', 'Sessions with TTL') }}
            </p>
          </div>

          <!-- L2 -->
          <div :class="['border', 'border-neutral-200', 'rounded-lg', 'bg-neutral-50', 'p-3', 'dark:border-neutral-700', 'dark:bg-neutral-800/50']">
            <div :class="['flex', 'items-center', 'justify-between']">
              <span :class="['text-xs', 'text-neutral-500', 'uppercase', 'font-semibold', 'dark:text-neutral-400']">L2 Semantic</span>
              <span :class="[l2StatusColor, 'text-xs', 'font-medium']">{{ l2StatusText }}</span>
            </div>
            <p :class="['mt-1', 'text-xs', 'text-neutral-600', 'dark:text-neutral-400']">
              {{ t('settings.memory.multilevel.l2.desc', 'Semantic search + embeddings') }}
            </p>
          </div>

          <!-- L3 -->
          <div :class="['border', 'border-neutral-200', 'rounded-lg', 'bg-neutral-50', 'p-3', 'dark:border-neutral-700', 'dark:bg-neutral-800/50']">
            <div :class="['flex', 'items-center', 'justify-between']">
              <span :class="['text-xs', 'text-neutral-500', 'uppercase', 'font-semibold', 'dark:text-neutral-400']">L3 Knowledge</span>
              <span :class="[l3StatusColor, 'text-xs', 'font-medium']">{{ l3StatusText }}</span>
            </div>
            <p :class="['mt-1', 'text-xs', 'text-neutral-600', 'dark:text-neutral-400']">
              {{ t('settings.memory.multilevel.l3.desc', 'Documents + versioning') }}
            </p>
          </div>
        </div>

        <!-- Actions -->
        <div v-if="enabled" :class="['flex', 'items-center', 'gap-3', 'pt-2']">
          <button
            :class="['rounded-md', 'bg-primary-500', 'px-4', 'py-2', 'text-sm', 'text-white', 'font-medium', 'hover:bg-primary-600', 'disabled:opacity-50', 'disabled:cursor-not-allowed']"
            :disabled="isSaving || initializationLoading || !isConfigured"
            @click="initializeMemory"
          >
            <span v-if="isSaving || initializationLoading">{{ t('common.loading', 'Loading...') }}</span>
            <span v-else>{{ t('common.initialize', 'Initialize') }}</span>
          </button>

          <button
            v-if="initialized"
            :class="['rounded-md', 'border', 'border-neutral-300', 'bg-white', 'px-4', 'py-2', 'text-sm', 'text-neutral-700', 'font-medium', 'hover:bg-neutral-50', 'dark:border-neutral-600', 'dark:bg-neutral-800', 'dark:text-neutral-200', 'dark:hover:bg-neutral-700']"
            @click="resetMemory"
          >
            {{ t('common.reset', 'Reset') }}
          </button>

          <span v-if="saveSuccess" :class="['text-sm', 'text-green-600', 'font-medium', 'dark:text-green-400']">
            ✓ {{ t('common.success', 'Success') }}
          </span>
          <span v-if="saveError" :class="['text-sm', 'text-red-600', 'dark:text-red-400']">
            {{ saveError }}
          </span>
        </div>

        <!-- Configuration Warning -->
        <div v-if="enabled && !isConfigured" :class="['border', 'border-orange-200', 'rounded-lg', 'bg-orange-50', 'px-4', 'py-3', 'dark:border-orange-800', 'dark:bg-orange-900/30']">
          <p :class="['text-sm', 'text-orange-800', 'dark:text-orange-200']">
            ⚠️ {{ t('settings.memory.multilevel.warning_config', 'Configuration incomplete. Configure L0, L1 (and optionally L2/L3) in the tabs below.') }}
          </p>
        </div>

        <!-- L2/L3 Incomplete Warning -->
        <div v-if="enabled && (l2Enabled && (!l2PostgresUrl || !l2OpenaiApiKey)) || (l3Enabled && (!l3PostgresUrl || !l3OpenaiApiKey))" :class="['border', 'border-orange-200', 'rounded-lg', 'bg-orange-50', 'px-4', 'py-3', 'dark:border-orange-800', 'dark:bg-orange-900/30']">
          <p :class="['text-sm', 'text-orange-800', 'dark:text-orange-200']">
            ⚠️ {{ t('settings.memory.multilevel.warning_l2_l3', 'L2/L3 is enabled but missing configuration. Fill in all required fields below, then re-initialize to create database tables.') }}
          </p>
        </div>
      </div>
    </section>

    <!-- L0 Configuration -->
    <section v-if="enabled" :class="['border', 'border-neutral-200', 'rounded-xl', 'bg-white/80', 'p-4', 'shadow-sm', 'dark:border-neutral-800', 'dark:bg-neutral-900/60']">
      <header :class="['flex', 'items-center', 'justify-between']">
        <div>
          <h2 :class="['text-lg', 'text-neutral-800', 'font-semibold', 'dark:text-neutral-100']">
            L0 - Working Set
          </h2>
          <p :class="['text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
            {{ t('settings.memory.multilevel.l0.subtitle', 'Recent messages, session summary, pinned facts') }}
          </p>
        </div>
        <label :class="['relative', 'inline-flex', 'items-center', 'cursor-pointer']">
          <input v-model="l0Enabled" type="checkbox" :class="['sr-only', 'peer']">
          <div :class="['w-11', 'h-6', 'bg-neutral-200', 'peer-focus:outline-none', 'peer-focus:ring-4', 'peer-focus:ring-primary-300', 'rounded-full', 'peer', 'dark:bg-neutral-700', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', 'after:content-[\'\']', 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-neutral-300', 'after:border', 'after:rounded-full', 'after:h-5', 'after:w-5', 'after:transition-all', 'dark:border-neutral-600', 'peer-checked:bg-primary-600']" />
        </label>
      </header>

      <div v-if="l0Enabled" :class="['mt-4', 'space-y-4']">
        <!-- Storage Type -->
        <div :class="['flex', 'flex-col', 'gap-2']">
          <label :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
            {{ t('settings.memory.multilevel.l0.storage', 'Storage Type') }}
          </label>
          <select v-model="l0Storage" :class="['w-full', 'border', 'border-neutral-200', 'rounded-md', 'bg-white', 'px-3', 'py-2', 'text-sm', 'dark:border-neutral-700', 'dark:bg-neutral-900']">
            <option value="memory">
              {{ t('settings.memory.multilevel.l0.storage_memory', 'In-Memory (RAM)') }}
            </option>
            <option value="redis">
              {{ t('settings.memory.multilevel.l0.storage_redis', 'Redis') }}
            </option>
          </select>
        </div>

        <!-- Redis URL (if redis selected) -->
        <div v-if="l0Storage === 'redis'" :class="['flex', 'flex-col', 'gap-2']">
          <label :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
            {{ t('settings.memory.multilevel.l0.redis_url', 'Redis URL') }}
          </label>
          <input
            v-model="l0RedisUrl"
            type="text"
            :class="['w-full', 'border', 'border-neutral-200', 'rounded-md', 'bg-white', 'px-3', 'py-2', 'text-sm', 'dark:border-neutral-700', 'dark:bg-neutral-900']"
            placeholder="redis://localhost:6379"
          >
        </div>

        <!-- Max Messages -->
        <div :class="['flex', 'flex-col', 'gap-2']">
          <label :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
            {{ t('settings.memory.multilevel.l0.max_messages', 'Max Messages') }}
          </label>
          <input
            v-model.number="l0MaxMessages"
            type="number"
            min="6"
            max="20"
            :class="['w-32', 'border', 'border-neutral-200', 'rounded-md', 'bg-white', 'px-3', 'py-2', 'text-sm', 'dark:border-neutral-700', 'dark:bg-neutral-900']"
          >
          <p :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-500']">
            {{ t('settings.memory.multilevel.l0.max_messages_hint', 'Recommended: 6-12 messages') }}
          </p>
        </div>

        <!-- Max Tokens -->
        <div :class="['flex', 'flex-col', 'gap-2']">
          <label :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
            {{ t('settings.memory.multilevel.l0.max_tokens', 'Max Tokens') }}
          </label>
          <input
            v-model.number="l0MaxTokens"
            type="number"
            min="1000"
            max="10000"
            :class="['w-32', 'border', 'border-neutral-200', 'rounded-md', 'bg-white', 'px-3', 'py-2', 'text-sm', 'dark:border-neutral-700', 'dark:bg-neutral-900']"
          >
        </div>

        <!-- Key Prefix -->
        <div :class="['flex', 'flex-col', 'gap-2']">
          <label :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
            {{ t('settings.memory.multilevel.l0.key_prefix', 'Key Prefix') }}
          </label>
          <input
            v-model="l0KeyPrefix"
            type="text"
            :class="['w-full', 'border', 'border-neutral-200', 'rounded-md', 'bg-white', 'px-3', 'py-2', 'text-sm', 'dark:border-neutral-700', 'dark:bg-neutral-900']"
            placeholder="airi:L0:"
          >
        </div>
      </div>
    </section>

    <!-- L1 Configuration -->
    <section v-if="enabled" :class="['border', 'border-neutral-200', 'rounded-xl', 'bg-white/80', 'p-4', 'shadow-sm', 'dark:border-neutral-800', 'dark:bg-neutral-900/60']">
      <header :class="['flex', 'items-center', 'justify-between']">
        <div>
          <h2 :class="['text-lg', 'text-neutral-800', 'font-semibold', 'dark:text-neutral-100']">
            L1 - Episodic Memory
          </h2>
          <p :class="['text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
            {{ t('settings.memory.multilevel.l1.subtitle', 'Session-based conversations with TTL') }}
          </p>
        </div>
        <label :class="['relative', 'inline-flex', 'items-center', 'cursor-pointer']">
          <input v-model="l1Enabled" type="checkbox" :class="['sr-only', 'peer']">
          <div :class="['w-11', 'h-6', 'bg-neutral-200', 'peer-focus:outline-none', 'peer-focus:ring-4', 'peer-focus:ring-primary-300', 'rounded-full', 'peer', 'dark:bg-neutral-700', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', 'after:content-[\'\']', 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-neutral-300', 'after:border', 'after:rounded-full', 'after:h-5', 'after:w-5', 'after:transition-all', 'dark:border-neutral-600', 'peer-checked:bg-primary-600']" />
        </label>
      </header>

      <div v-if="l1Enabled" :class="['mt-4', 'space-y-4']">
        <!-- Storage Type -->
        <div :class="['flex', 'flex-col', 'gap-2']">
          <label :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
            {{ t('settings.memory.multilevel.l1.storage', 'Storage Type') }}
          </label>
          <select v-model="l1Storage" :class="['w-full', 'border', 'border-neutral-200', 'rounded-md', 'bg-white', 'px-3', 'py-2', 'text-sm', 'dark:border-neutral-700', 'dark:bg-neutral-900']">
            <option value="redis">
              {{ t('settings.memory.multilevel.l1.storage_redis', 'Redis Only') }}
            </option>
            <option value="postgres">
              {{ t('settings.memory.multilevel.l1.storage_postgres', 'PostgreSQL Only') }}
            </option>
            <option value="both">
              {{ t('settings.memory.multilevel.l1.storage_both', 'Redis + PostgreSQL (Recommended)') }}
            </option>
          </select>
        </div>

        <!-- Redis URL -->
        <div v-if="l1Storage === 'redis' || l1Storage === 'both'" :class="['flex', 'flex-col', 'gap-2']">
          <label :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
            {{ t('settings.memory.multilevel.l1.redis_url', 'Redis URL') }}
          </label>
          <input
            v-model="l1RedisUrl"
            type="text"
            :class="['w-full', 'border', 'border-neutral-200', 'rounded-md', 'bg-white', 'px-3', 'py-2', 'text-sm', 'dark:border-neutral-700', 'dark:bg-neutral-900']"
            placeholder="redis://localhost:6379"
          >
        </div>

        <!-- Postgres URL -->
        <div v-if="l1Storage === 'postgres' || l1Storage === 'both'" :class="['flex', 'flex-col', 'gap-2']">
          <label :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
            {{ t('settings.memory.multilevel.l1.postgres_url', 'PostgreSQL URL') }}
          </label>
          <input
            v-model="l1PostgresUrl"
            type="text"
            :class="['w-full', 'border', 'border-neutral-200', 'rounded-md', 'bg-white', 'px-3', 'py-2', 'text-sm', 'dark:border-neutral-700', 'dark:bg-neutral-900']"
            placeholder="postgresql://user:password@localhost:5432/database"
          >
        </div>

        <!-- Session TTL -->
        <div :class="['flex', 'flex-col', 'gap-2']">
          <label :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
            {{ t('settings.memory.multilevel.l1.session_ttl', 'Session TTL (seconds)') }}
          </label>
          <input
            v-model.number="l1SessionTtl"
            type="number"
            min="3600"
            :class="['w-40', 'border', 'border-neutral-200', 'rounded-md', 'bg-white', 'px-3', 'py-2', 'text-sm', 'dark:border-neutral-700', 'dark:bg-neutral-900']"
          >
          <p :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-500']">
            {{ t('settings.memory.multilevel.l1.session_ttl_hint', 'Default: 7 days (604800s)') }}
          </p>
        </div>

        <!-- Table Name -->
        <div :class="['flex', 'flex-col', 'gap-2']">
          <label :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
            {{ t('settings.memory.multilevel.l1.table_name', 'Table Name') }}
          </label>
          <input
            v-model="l1TableName"
            type="text"
            :class="['w-full', 'border', 'border-neutral-200', 'rounded-md', 'bg-white', 'px-3', 'py-2', 'text-sm', 'dark:border-neutral-700', 'dark:bg-neutral-900']"
            placeholder="l1_episodic_memory"
          >
        </div>

        <!-- Key Prefix -->
        <div :class="['flex', 'flex-col', 'gap-2']">
          <label :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
            {{ t('settings.memory.multilevel.l1.key_prefix', 'Key Prefix (Redis)') }}
          </label>
          <input
            v-model="l1KeyPrefix"
            type="text"
            :class="['w-full', 'border', 'border-neutral-200', 'rounded-md', 'bg-white', 'px-3', 'py-2', 'text-sm', 'dark:border-neutral-700', 'dark:bg-neutral-900']"
            placeholder="airi:L1:"
          >
        </div>
      </div>
    </section>

    <!-- L2 Configuration -->
    <section v-if="enabled" :class="['border', 'border-neutral-200', 'rounded-xl', 'bg-white/80', 'p-4', 'shadow-sm', 'dark:border-neutral-800', 'dark:bg-neutral-900/60']">
      <header :class="['flex', 'items-center', 'justify-between']">
        <div>
          <h2 :class="['text-lg', 'text-neutral-800', 'font-semibold', 'dark:text-neutral-100']">
            L2 - Semantic Memory
          </h2>
          <p :class="['text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
            {{ t('settings.memory.multilevel.l2.subtitle', 'Conversations, notes, snippets with semantic search') }}
          </p>
        </div>
        <label :class="['relative', 'inline-flex', 'items-center', 'cursor-pointer']">
          <input v-model="l2Enabled" type="checkbox" :class="['sr-only', 'peer']">
          <div :class="['w-11', 'h-6', 'bg-neutral-200', 'peer-focus:outline-none', 'peer-focus:ring-4', 'peer-focus:ring-primary-300', 'rounded-full', 'peer', 'dark:bg-neutral-700', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', 'after:content-[\'\']', 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-neutral-300', 'after:border', 'after:rounded-full', 'after:h-5', 'after:w-5', 'after:transition-all', 'dark:border-neutral-600', 'peer-checked:bg-primary-600']" />
        </label>
      </header>

      <div v-if="l2Enabled" :class="['mt-4', 'space-y-4']">
        <!-- Postgres URL -->
        <div :class="['flex', 'flex-col', 'gap-2']">
          <label :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
            {{ t('settings.memory.multilevel.l2.postgres_url', 'PostgreSQL URL (with pgvector)') }}
          </label>
          <input
            v-model="l2PostgresUrl"
            type="text"
            :class="['w-full', 'border', 'border-neutral-200', 'rounded-md', 'bg-white', 'px-3', 'py-2', 'text-sm', 'dark:border-neutral-700', 'dark:bg-neutral-900']"
            placeholder="postgresql://user:password@localhost:5432/database"
          >
        </div>

        <!-- Table Name -->
        <div :class="['flex', 'flex-col', 'gap-2']">
          <label :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
            {{ t('settings.memory.multilevel.l2.table_name', 'Table Name') }}
          </label>
          <input
            v-model="l2TableName"
            type="text"
            :class="['w-full', 'border', 'border- neutral-200', 'rounded-md', 'bg-white', 'px-3', 'py-2', 'text-sm', 'dark:border-neutral-700', 'dark:bg-neutral-900']"
            placeholder="l2_semantic_memory"
          >
        </div>

        <!-- OpenAI API Key -->
        <div :class="['flex', 'flex-col', 'gap-2']">
          <label :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
            {{ t('settings.memory.multilevel.l2.openai_api_key', 'OpenAI API Key') }}
          </label>
          <input
            v-model="l2OpenaiApiKey"
            type="password"
            :class="['w-full', 'border', 'border-neutral-200', 'rounded-md', 'bg-white', 'px-3', 'py-2', 'text-sm', 'dark:border-neutral-700', 'dark:bg-neutral-900']"
            placeholder="sk-..."
          >
        </div>

        <!-- OpenAI Base URL (Optional) -->
        <div :class="['flex', 'flex-col', 'gap-2']">
          <label :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
            {{ t('settings.memory.multilevel.l2.openai_base_url', 'OpenAI Base URL (Optional)') }}
          </label>
          <input
            v-model="l2OpenaiBaseUrl"
            type="text"
            :class="['w-full', 'border', 'border-neutral-200', 'rounded-md', 'bg-white', 'px-3', 'py-2', 'text-sm', 'dark:border-neutral-700', 'dark:bg-neutral-900']"
            placeholder="https://api.openai.com/v1"
          >
        </div>

        <!-- Embedding Model -->
        <div :class="['flex', 'flex-col', 'gap-2']">
          <label :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
            {{ t('settings.memory.multilevel.l2.embedding_model', 'Embedding Model') }}
          </label>
          <input
            v-model="l2EmbeddingModel"
            type="text"
            :class="['w-full', 'border', 'border-neutral-200', 'rounded-md', 'bg-white', 'px-3', 'py-2', 'text-sm', 'dark:border-neutral-700', 'dark:bg-neutral-900']"
            placeholder="text-embedding-3-small"
          >
        </div>

        <!-- Use Hybrid Search -->
        <div :class="['flex', 'items-center', 'justify-between']">
          <div>
            <span :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
              {{ t('settings.memory.multilevel.l2.use_hybrid_search', 'Enable Hybrid Search') }}
            </span>
            <p :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-500']">
              {{ t('settings.memory.multilevel.l2.use_hybrid_search_hint', 'Combines vector + keyword search') }}
            </p>
          </div>
          <label :class="['relative', 'inline-flex', 'items-center', 'cursor-pointer']">
            <input v-model="l2UseHybridSearch" type="checkbox" :class="['sr-only', 'peer']">
            <div :class="['w-11', 'h-6', 'bg-neutral-200', 'peer-focus:outline-none', 'peer-focus:ring-4', 'peer-focus:ring-primary-300', 'rounded-full', 'peer', 'dark:bg-neutral-700', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', 'after:content-[\'\']', 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-neutral-300', 'after:border', 'after:rounded-full', 'after:h-5', 'after:w-5', 'after:transition-all', 'dark:border-neutral-600', 'peer-checked:bg-primary-600']" />
          </label>
        </div>
      </div>
    </section>

    <!-- L3 Configuration -->
    <section v-if="enabled" :class="['border', 'border-neutral-200', 'rounded-xl', 'bg-white/80', 'p-4', 'shadow-sm', 'dark:border-neutral-800', 'dark:bg-neutral-900/60']">
      <header :class="['flex', 'items-center', 'justify-between']">
        <div>
          <h2 :class="['text-lg', 'text-neutral-800', 'font-semibold', 'dark:text-neutral-100']">
            L3 - Knowledge Base
          </h2>
          <p :class="['text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
            {{ t('settings.memory.multilevel.l3.subtitle', 'Documents, code, markdown with semantic search + versioning') }}
          </p>
        </div>
        <label :class="['relative', 'inline-flex', 'items-center', 'cursor-pointer']">
          <input v-model="l3Enabled" type="checkbox" :class="['sr-only', 'peer']">
          <div :class="['w-11', 'h-6', 'bg-neutral-200', 'peer-focus:outline-none', 'peer-focus:ring-4', 'peer-focus:ring-primary-300', 'rounded-full', 'peer', 'dark:bg-neutral-700', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', 'after:content-[\'\']', 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-neutral-300', 'after:border', 'after:rounded-full', 'after:h-5', 'after:w-5', 'after:transition-all', 'dark:border-neutral-600', 'peer-checked:bg-primary-600']" />
        </label>
      </header>

      <div v-if="l3Enabled" :class="['mt-4', 'space-y-4']">
        <!-- Postgres URL -->
        <div :class="['flex', 'flex-col', 'gap-2']">
          <label :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
            {{ t('settings.memory.multilevel.l3.postgres_url', 'PostgreSQL URL (with pgvector)') }}
          </label>
          <input
            v-model="l3PostgresUrl"
            type="text"
            :class="['w-full', 'border', 'border-neutral-200', 'rounded-md', 'bg-white', 'px-3', 'py-2', 'text-sm', 'dark:border-neutral-700', 'dark:bg-neutral-900']"
            placeholder="postgresql://user:password@localhost:5432/database"
          >
        </div>

        <!-- Table Name -->
        <div :class="['flex', 'flex-col', 'gap-2']">
          <label :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
            {{ t('settings.memory.multilevel.l3.table_name', 'Table Name') }}
          </label>
          <input
            v-model="l3TableName"
            type="text"
            :class="['w-full', 'border', 'border-neutral-200', 'rounded-md', 'bg-white', 'px-3', 'py-2', 'text-sm', 'dark:border-neutral-700', 'dark:bg-neutral-900']"
            placeholder="l3_knowledge_base"
          >
        </div>

        <!-- OpenAI API Key -->
        <div :class="['flex', 'flex-col', 'gap-2']">
          <label :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
            {{ t('settings.memory.multilevel.l3.openai_api_key', 'OpenAI API Key') }}
          </label>
          <input
            v-model="l3OpenaiApiKey"
            type="password"
            :class="['w-full', 'border', 'border-neutral-200', 'rounded-md', 'bg-white', 'px-3', 'py-2', 'text-sm', 'dark:border-neutral-700', 'dark:bg-neutral-900']"
            placeholder="sk-..."
          >
        </div>

        <!-- OpenAI Base URL (Optional) -->
        <div :class="['flex', 'flex-col', 'gap-2']">
          <label :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
            {{ t('settings.memory.multilevel.l3.openai_base_url', 'OpenAI Base URL (Optional)') }}
          </label>
          <input
            v-model="l3OpenaiBaseUrl"
            type="text"
            :class="['w-full', 'border', 'border-neutral-200', 'rounded-md', 'bg-white', 'px-3', 'py-2', 'text-sm', 'dark:border-neutral-700', 'dark:bg-neutral-900']"
            placeholder="https://api.openai.com/v1"
          >
        </div>

        <!-- Embedding Model -->
        <div :class="['flex', 'flex-col', 'gap-2']">
          <label :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
            {{ t('settings.memory.multilevel.l3.embedding_model', 'Embedding Model') }}
          </label>
          <input
            v-model="l3EmbeddingModel"
            type="text"
            :class="['w-full', 'border', 'border-neutral-200', 'rounded-md', 'bg-white', 'px-3', 'py-2', 'text-sm', 'dark:border-neutral-700', 'dark:bg-neutral-900']"
            placeholder="text-embedding-3-small"
          >
        </div>

        <!-- Use Hybrid Search -->
        <div :class="['flex', 'items-center', 'justify-between']">
          <div>
            <span :class="['text-sm', 'text-neutral-700', 'font-medium', 'dark:text-neutral-200']">
              {{ t('settings.memory.multilevel.l3.use_hybrid_search', 'Enable Hybrid Search') }}
            </span>
            <p :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-500']">
              {{ t('settings.memory.multilevel.l3.use_hybrid_search_hint', 'Combines vector + keyword search') }}
            </p>
          </div>
          <label :class="['relative', 'inline-flex', 'items-center', 'cursor-pointer']">
            <input v-model="l3UseHybridSearch" type="checkbox" :class="['sr-only', 'peer']">
            <div :class="['w-11', 'h-6', 'bg-neutral-200', 'peer-focus:outline-none', 'peer-focus:ring-4', 'peer-focus:ring-primary-300', 'rounded-full', 'peer', 'dark:bg-neutral-700', 'peer-checked:after:translate-x-full', 'peer-checked:after:border-white', 'after:content-[\'\']', 'after:absolute', 'after:top-[2px]', 'after:left-[2px]', 'after:bg-white', 'after:border-neutral-300', 'after:border', 'after:rounded-full', 'after:h-5', 'after:w-5', 'after:transition-all', 'dark:border-neutral-600', 'peer-checked:bg-primary-600']" />
          </label>
        </div>
      </div>
    </section>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.memory-multilevel.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>

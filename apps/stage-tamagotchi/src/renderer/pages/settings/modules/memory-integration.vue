<script setup lang="ts">
import { useMultilevelMemoryStore } from '@proj-airi/stage-ui/stores/memory-multilevel'
import { useMemoryIntegrationStore } from '@proj-airi/stage-ui/stores/modules/memory-integration'
import { Button, Callout } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'

const memoryIntegration = useMemoryIntegrationStore()
const memorySystem = useMultilevelMemoryStore()

const {
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
} = storeToRefs(memoryIntegration)

const memorySystemStatus = computed(() => {
  if (!memorySystem.initialized)
    return 'not-initialized'
  if (canUse.value)
    return 'active'
  return 'disabled'
})

const statusTheme = computed(() => {
  switch (memorySystemStatus.value) {
    case 'active': return 'lime'
    case 'not-initialized': return 'orange'
    case 'disabled': return 'primary'
    default: return 'primary'
  }
})

const statusLabel = computed(() => {
  switch (memorySystemStatus.value) {
    case 'active': return 'Active & Running'
    case 'not-initialized': return 'Memory System Not Initialized'
    case 'disabled': return 'Disabled'
    default: return 'Unknown'
  }
})

async function handleInitialize() {
  await memoryIntegration.initialize()
}

function handleDisable() {
  memoryIntegration.disable()
}
</script>

<template>
  <div :class="['space-y-6', 'pb-12']">
    <!-- Status -->
    <Callout :theme="statusTheme" :label="`Status: ${statusLabel}`">
      <div :class="['flex', 'flex-col', 'gap-2']">
        <p :class="['text-sm']">
          {{ memorySystemStatus === 'not-initialized' ? 'Initialize the Memory Multilevel system first in Settings → Modules → Memory Multilevel' : '' }}
          {{ memorySystemStatus === 'disabled' ? 'Enable the module to start saving and retrieving memory context' : '' }}
          {{ memorySystemStatus === 'active' ? 'Memory integration is active. Chat messages are being saved and context is injected automatically.' : '' }}
        </p>
        <div v-if="lastError" :class="['text-xs', 'opacity-80', 'font-mono', 'bg-red-500/10', 'p-2', 'rounded']">
          Error: {{ lastError }}
        </div>
      </div>
    </Callout>

    <!-- Enable/Disable -->
    <div :class="['space-y-4']">
      <label :class="['flex', 'flex-col', 'gap-4']">
        <div :class="['flex', 'flex-row', 'items-center', 'gap-2']">
          <div :class="['flex-1']">
            <div :class="['flex', 'items-center', 'gap-1', 'text-sm', 'font-medium']">
              Enable Memory Integration
            </div>
            <div :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
              Automatically save messages and inject context
            </div>
          </div>
          <input
            v-model="enabled"
            type="checkbox"
            :disabled="!memorySystem.initialized"
            :class="['h-4', 'w-4', 'accent-primary-500']"
          >
        </div>
      </label>
    </div>

    <!-- Saving Options -->
    <div :class="['space-y-4']">
      <h3 :class="['text-lg', 'font-semibold']">
        Saving Options
      </h3>

      <label :class="['flex', 'flex-col', 'gap-4']">
        <div :class="['flex', 'flex-row', 'items-center', 'gap-2']">
          <div :class="['flex-1']">
            <div :class="['flex', 'items-center', 'gap-1', 'text-sm', 'font-medium']">
              Save to L0 (Working Set)
            </div>
            <div :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
              Save recent messages to in-memory working set
            </div>
          </div>
          <input
            v-model="saveToL0"
            type="checkbox"
            :disabled="!enabled"
            :class="['h-4', 'w-4', 'accent-primary-500']"
          >
        </div>
      </label>

      <label :class="['flex', 'flex-col', 'gap-4']">
        <div :class="['flex', 'flex-row', 'items-center', 'gap-2']">
          <div :class="['flex-1']">
            <div :class="['flex', 'items-center', 'gap-1', 'text-sm', 'font-medium']">
              Save to L1 (Episodic Memory)
            </div>
            <div :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
              Save session messages to PostgreSQL with TTL
            </div>
          </div>
          <input
            v-model="saveToL1"
            type="checkbox"
            :disabled="!enabled"
            :class="['h-4', 'w-4', 'accent-primary-500']"
          >
        </div>
      </label>

      <label :class="['flex', 'flex-col', 'gap-4']">
        <div :class="['flex', 'flex-row', 'items-center', 'gap-2']">
          <div :class="['flex-1']">
            <div :class="['flex', 'items-center', 'gap-1', 'text-sm', 'font-medium']">
              Save to L2 (Semantic Memory)
              <span :class="['text-xs', 'text-primary-500']">✨ New</span>
            </div>
            <div :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
              Chunk and embed conversations for semantic search
            </div>
          </div>
          <input
            v-model="saveToL2"
            type="checkbox"
            :disabled="!enabled || !memorySystem.l2Enabled"
            :class="['h-4', 'w-4', 'accent-primary-500']"
          >
        </div>
      </label>
    </div>

    <!-- Retrieval Options -->
    <div :class="['space-y-4']">
      <h3 :class="['text-lg', 'font-semibold']">
        Context Retrieval Options
      </h3>

      <label :class="['flex', 'flex-col', 'gap-4']">
        <div :class="['flex', 'flex-row', 'items-center', 'gap-2']">
          <div :class="['flex-1']">
            <div :class="['flex', 'items-center', 'gap-1', 'text-sm', 'font-medium']">
              Retrieve from L1 (Recent Sessions)
            </div>
            <div :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
              Search recent session messages for context
            </div>
          </div>
          <input
            v-model="retrieveFromL1"
            type="checkbox"
            :disabled="!enabled"
            :class="['h-4', 'w-4', 'accent-primary-500']"
          >
        </div>
      </label>

      <label :class="['flex', 'flex-col', 'gap-4']">
        <div :class="['flex', 'flex-row', 'items-center', 'gap-2']">
          <div :class="['flex-1']">
            <div :class="['flex', 'items-center', 'gap-1', 'text-sm', 'font-medium']">
              Retrieve from L2 (Semantic Memory)
            </div>
            <div :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
              Search past conversations semantically
            </div>
          </div>
          <input
            v-model="retrieveFromL2"
            type="checkbox"
            :disabled="!enabled"
            :class="['h-4', 'w-4', 'accent-primary-500']"
          >
        </div>
      </label>

      <div :class="['flex', 'flex-col', 'gap-2']">
        <label :class="['text-sm', 'font-medium']">L1 Context Messages Limit</label>
        <input
          v-model.number="contextMessagesLimit"
          type="number"
          :min="1"
          :max="20"
          :disabled="!enabled || !retrieveFromL1"
          :class="[
            'w-full', 'rounded-lg', 'px-2', 'py-1', 'text-sm', 'outline-none',
            'border-2', 'border-solid', 'border-neutral-100', 'dark:border-neutral-900',
            'bg-neutral-50', 'dark:bg-neutral-950',
            'focus:border-primary-300', 'dark:focus:border-primary-400/50',
            'disabled:cursor-not-allowed', 'disabled:opacity-50',
          ]"
        >
        <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
          Number of recent messages to retrieve (1-20)
        </span>
      </div>

      <div :class="['flex', 'flex-col', 'gap-2']">
        <label :class="['text-sm', 'font-medium']">L2 Semantic Search Limit</label>
        <input
          v-model.number="semanticSearchLimit"
          type="number"
          :min="1"
          :max="20"
          :disabled="!enabled || !retrieveFromL2"
          :class="[
            'w-full', 'rounded-lg', 'px-2', 'py-1', 'text-sm', 'outline-none',
            'border-2', 'border-solid', 'border-neutral-100', 'dark:border-neutral-900',
            'bg-neutral-50', 'dark:bg-neutral-950',
            'focus:border-primary-300', 'dark:focus:border-primary-400/50',
            'disabled:cursor-not-allowed', 'disabled:opacity-50',
          ]"
        >
        <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
          Number of semantic results to retrieve (1-20)
        </span>
      </div>
    </div>

    <!-- Actions -->
    <div :class="['flex', 'gap-3']">
      <Button
        v-if="!isInitialized && memorySystem.initialized"
        @click="handleInitialize"
      >
        Initialize Memory Integration
      </Button>

      <Button
        v-if="isInitialized"
        @click="handleDisable"
      >
        Disable & Cleanup
      </Button>
    </div>

    <!-- Info -->
    <Callout theme="violet" label="How it works">
      <div :class="['flex', 'flex-col', 'gap-2', 'text-sm']">
        <p>
          <strong>Automatic Saving:</strong> When enabled, every chat message (user and assistant) is automatically saved to the configured memory levels.
        </p>
        <p>
          <strong>Context Injection:</strong> Before sending a message to the LLM, the system searches your memory for relevant context and injects it into the conversation.
        </p>
        <p>
          <strong>Smart Retrieval:</strong> Uses both recent session search (L1) and semantic similarity search (L2) to find the most relevant past conversations.
        </p>
      </div>
    </Callout>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  settingsEntry: true
  icon: i-lucide-brain-circuit
  title: Memory Integration
  description: Automatically save and retrieve conversation context
  order: 6
</route>

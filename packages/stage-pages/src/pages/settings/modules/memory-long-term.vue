<script setup lang="ts">
import LongTermSection from '../memory/components/LongTermSection.vue'
</script>

<template>
  <LongTermSection />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.memory-long-term.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>

<script setup lang="ts">
import ShortTermSection from '../memory/components/ShortTermSection.vue'
</script>

<template>
  <ShortTermSection />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.memory-short-term.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>

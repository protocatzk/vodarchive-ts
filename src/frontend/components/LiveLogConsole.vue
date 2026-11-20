<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type { LogLine } from '../types';

const props = defineProps<{ logs: LogLine[] }>();
const consoleEl = ref<HTMLDivElement | null>(null);

watch(
  () => props.logs.length,
  async () => {
    await nextTick();
    if (consoleEl.value) consoleEl.value.scrollTop = consoleEl.value.scrollHeight;
  },
);

const levelClass: Record<LogLine['level'], string> = {
  INFO: 'log-info',
  WARNING: 'log-warning',
  ERROR: 'log-error',
  DEBUG: 'text-slate-500',
};
</script>

<template>
  <div class="card card-body">
    <div class="flex flex-wrap items-center justify-between">
      <div class="card-title">Archivierungsprotokoll</div>
      <span class="text-xs text-text-muted">Echtzeit-Meldungen</span>
    </div>
    <div ref="consoleEl" class="logs-console">
      <div v-if="props.logs.length === 0" class="text-slate-500">Verbinde mit Live-Log Stream...</div>
      <div v-for="(line, index) in props.logs" :key="index" class="log-line">
        <span class="text-[rgba(122,113,95,0.6)]">{{ line.time }}</span>
        <span :class="levelClass[line.level]"> [{{ line.level }}]</span>
        <span class="text-text/90"> {{ line.message }}</span>
      </div>
    </div>
  </div>
</template>

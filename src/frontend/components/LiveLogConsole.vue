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
  DEBUG: 'text-[var(--ink-faint)]',
};
</script>

<template>
  <div>
    <div class="sheet-head">
      <div class="sheet-title">Archivierungsprotokoll</div>
      <span class="meta">Echtzeit · Schreibmaschine</span>
    </div>
    <div ref="consoleEl" class="logs-console">
      <div v-if="props.logs.length === 0" style="color: var(--ink-faint)">
        Verbinde mit dem Protokoll …
      </div>
      <div v-for="(line, index) in props.logs" :key="index" class="log-line">
        <span style="color: var(--ink-faint)">{{ line.time }}</span>
        <span :class="levelClass[line.level]"> [{{ line.level }}]</span>
        <span> {{ line.message }}</span>
      </div>
    </div>
  </div>
</template>

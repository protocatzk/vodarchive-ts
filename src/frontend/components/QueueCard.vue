<script setup lang="ts">
import type { QueueItem } from '../types';

defineProps<{ queue: QueueItem[] }>();
const emit = defineEmits<{ (e: 'cancel', key: string): void }>();
</script>

<template>
  <div>
    <div class="sheet-head">
      <div class="sheet-title">Warteschlange</div>
      <span class="stamp" :class="queue.length ? 'stamp-brass' : 'stamp-muted'">
        {{ queue.length }} wartend
      </span>
    </div>

    <div v-if="queue.length === 0" class="py-12 text-center">
      <div class="typewriter text-sm" style="color: var(--ink-soft)">Keine wartenden Vorgänge.</div>
      <div class="mt-2 text-sm italic" style="color: var(--ink-faint)">Das Regal ist leer.</div>
    </div>

    <ul v-else class="space-y-2">
      <li v-for="(item, index) in queue" :key="item.key" class="queue-item">
        <div class="flex min-w-0 items-baseline gap-3">
          <span class="typewriter text-xs" style="color: var(--ink-faint)">#{{ index + 1 }}</span>
          <div class="min-w-0">
            <div class="font-display font-semibold leading-tight">{{ item.streamer }}</div>
            <div class="job-stage truncate">{{ item.title }}</div>
          </div>
        </div>
        <button
          type="button"
          class="btn btn-danger !px-2 !py-0.5"
          title="Vorgang abbrechen"
          @click="emit('cancel', item.key)"
        >
          ✕
        </button>
      </li>
    </ul>
  </div>
</template>

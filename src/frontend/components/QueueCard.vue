<script setup lang="ts">
import type { QueueItem } from '../types';

defineProps<{ queue: QueueItem[] }>();
const emit = defineEmits<{ (e: 'cancel', key: string): void }>();
</script>

<template>
  <div class="card">
    <div class="mb-4 flex items-center justify-between">
      <div class="card-title">Warteschlange</div>
      <span class="badge badge-idle">{{ queue.length }} wartend</span>
    </div>

    <div v-if="queue.length === 0" class="py-6 text-center text-sm text-muted">
      Keine wartenden VODs.
    </div>

    <ul v-else class="space-y-2">
      <li
        v-for="(item, index) in queue"
        :key="item.key"
        class="flex items-center justify-between gap-3 rounded-lg border border-card-border bg-slate-900/40 px-3 py-2"
      >
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold text-slate-100">{{ item.streamer }}</div>
          <div class="truncate text-xs text-muted">{{ item.title }}</div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <span class="text-xs text-muted">#{{ index + 1 }}</span>
          <button
            type="button"
            class="btn btn-danger !px-2 !py-0.5 text-xs"
            title="Job abbrechen"
            @click="emit('cancel', item.key)"
          >
            ✕
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { QueueItem } from '../types';

defineProps<{ queue: QueueItem[] }>();
const emit = defineEmits<{ (e: 'cancel', key: string): void }>();
</script>

<template>
  <div class="card card-body">
    <div class="flex flex-wrap items-center justify-between">
      <div class="card-title">Warteschlange</div>
      <span class="badge badge-idle">{{ queue.length }} wartend</span>
    </div>

    <div v-if="queue.length === 0" class="mt-4 text-sm text-text-muted">
      Keine wartenden Aufnahmen.
    </div>

    <ul v-else class="mt-4 space-y-2">
      <li
        v-for="(item, index) in queue"
        :key="item.key"
        class="queue-item"
      >
        <div class="min-w-0">
          <div class="font-display font-semibold text-text">{{ item.streamer }}</div>
          <div class="font-display text-sm italic text-text-muted truncate">{{ item.title }}</div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <span class="stat-label">#{{ index + 1 }}</span>
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

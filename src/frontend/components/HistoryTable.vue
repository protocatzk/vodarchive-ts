<script setup lang="ts">
import type { HistoryItem } from '../types';

defineProps<{ history: HistoryItem[] }>();
const emit = defineEmits<{ (e: 'clear'): void }>();

function stampClass(status: HistoryItem['status']): string {
  if (status === 'success') return 'stamp-green';
  if (status === 'cancelled') return 'stamp-brass';
  return 'stamp-red';
}

function statusLabel(status: HistoryItem['status']): string {
  if (status === 'success') return 'Archiviert';
  if (status === 'cancelled') return 'Abgebrochen';
  return 'Fehler';
}
</script>

<template>
  <div>
    <div class="sheet-head">
      <div class="sheet-title">Bestandsbuch</div>
      <div class="flex items-center gap-3">
        <span class="meta">{{ history.length }} Einträge</span>
        <button type="button" class="btn" :disabled="history.length === 0" @click="emit('clear')">
          Verlauf leeren
        </button>
      </div>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th class="min-w-[8rem]">Zeit</th>
            <th class="min-w-[10rem]">Streamer</th>
            <th class="min-w-[20rem]">Titel</th>
            <th class="min-w-[7rem]">Umfang</th>
            <th class="min-w-[8rem]">Register</th>
            <th class="min-w-[6rem] text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="history.length === 0">
            <td colspan="6" class="py-10 text-center italic" style="color: var(--ink-faint)">
              Noch keine VODs in diesem Bestand eingetragen.
            </td>
          </tr>
          <tr v-for="(item, index) in history" :key="`${item.finished_at}-${index}`">
            <td class="typewriter text-xs" style="color: var(--ink-faint)">{{ item.finished_at }}</td>
            <td class="font-display font-semibold">{{ item.streamer }}</td>
            <td class="italic">{{ item.title }}</td>
            <td class="typewriter text-xs" style="color: var(--ink-soft)">
              {{ item.parts }} Teil(e) · {{ item.total_size_mb }} MB
            </td>
            <td>
              <a
                v-if="item.topic_id"
                class="topic-link"
                :href="`https://t.me/RippersArchiv/${item.topic_id}`"
                target="_blank"
                rel="noopener"
              >
                💬 {{ item.topic_name || `Topic #${item.topic_id}` }}
              </a>
              <span v-else style="color: var(--ink-faint)">—</span>
            </td>
            <td class="text-right">
              <span class="stamp" :class="stampClass(item.status)">{{ statusLabel(item.status) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { HistoryItem } from '../types';

defineProps<{ history: HistoryItem[] }>();

function statusClass(status: HistoryItem['status']): string {
  if (status === 'success') return 'text-emerald';
  if (status === 'cancelled') return 'text-amber';
  return 'text-rose';
}

function statusLabel(status: HistoryItem['status']): string {
  if (status === 'success') return '✓ Fertig';
  if (status === 'cancelled') return '⊘ Abgebrochen';
  return '✗ Fehler';
}
</script>

<template>
  <div class="card card-body">
    <div class="flex flex-wrap items-center justify-between">
      <div class="card-title">Kürzlich archivierte VODs</div>
      <span class="text-xs text-text-muted">{{ history.length }} Einträge</span>
    </div>

    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th class="min-w-[8rem]">Zeitstempel</th>
            <th class="min-w-[10rem]">Streamer</th>
            <th class="min-w-[22rem]">Titel</th>
            <th class="min-w-[6rem]">Größe</th>
            <th class="min-w-[8rem]">Topic</th>
            <th class="min-w-[4rem] text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="history.length === 0">
            <td colspan="6" class="py-10 text-center text-text-muted">
              Noch keine VODs in dieser Session hochgeladen.
            </td>
          </tr>
          <tr
            v-for="(item, index) in history"
            :key="`${item.finished_at}-${index}`"
            class="history-card"
          >
            <td class="history-date">{{ item.finished_at }}</td>
            <td class="font-display font-semibold text-text">{{ item.streamer }}</td>
            <td class="font-display text-sm italic text-text">{{ item.title }}</td>
            <td class="text-muted">{{ item.parts }} Teil(e) ({{ item.total_size_mb }} MB)</td>
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
              <span v-else class="text-muted">-</span>
            </td>
            <td class="text-right font-semibold" :class="statusClass(item.status)">
              {{ statusLabel(item.status) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

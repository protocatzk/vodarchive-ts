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
  <div class="card">
    <div class="mb-4 flex items-center justify-between">
      <div class="card-title">Kürzlich archivierte VODs</div>
      <span class="text-xs text-muted">{{ history.length }} Einträge</span>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full text-left text-sm">
        <thead>
          <tr class="border-b border-card-border text-xs uppercase tracking-wide text-muted">
            <th class="py-2 pr-4 font-medium">Zeitstempel</th>
            <th class="py-2 pr-4 font-medium">Streamer</th>
            <th class="py-2 pr-4 font-medium">Titel</th>
            <th class="py-2 pr-4 font-medium">Dateien / Größe</th>
            <th class="py-2 pr-4 font-medium">Ziel-Topic</th>
            <th class="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="history.length === 0">
            <td colspan="6" class="py-8 text-center text-muted">
              Noch keine VODs in dieser Session hochgeladen.
            </td>
          </tr>
          <tr
            v-for="(item, index) in history"
            :key="`${item.finished_at}-${index}`"
            class="border-b border-card-border/50 last:border-0"
          >
            <td class="py-2 pr-4 text-muted">{{ item.finished_at }}</td>
            <td class="py-2 pr-4 font-semibold text-slate-100">{{ item.streamer }}</td>
            <td class="py-2 pr-4">{{ item.title }}</td>
            <td class="py-2 pr-4">{{ item.parts }} Teil(e) ({{ item.total_size_mb }} MB)</td>
            <td class="py-2 pr-4">
              <a
                v-if="item.topic_id"
                class="text-cyan hover:underline"
                :href="`https://t.me/RippersArchiv/${item.topic_id}`"
                target="_blank"
                rel="noopener"
              >
                💬 {{ item.topic_name || `Topic #${item.topic_id}` }}
              </a>
              <span v-else class="text-muted">-</span>
            </td>
            <td class="py-2 font-semibold" :class="statusClass(item.status)">
              {{ statusLabel(item.status) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

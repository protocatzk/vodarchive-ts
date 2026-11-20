<script setup lang="ts">
import { computed } from 'vue';
import type { RssStatus } from '../types';

const props = defineProps<{ rss: RssStatus | null }>();
const emit = defineEmits<{
  (e: 'trigger'): void;
  (e: 'backfill'): void;
  (e: 'reset'): void;
}>();

const badge = computed<{ text: string; cls: string; title: string }>(() => {
  const rss = props.rss;
  if (!rss || !rss.enabled) return { text: 'AUS', cls: 'badge-idle', title: '' };
  if (rss.cookies?.broken) {
    return {
      text: 'COOKIES UNGÜLTIG',
      cls: 'badge-live',
      title: rss.cookies.reason || 'Cookie-Datei ersetzen und Retries zurücksetzen',
    };
  }
  if (rss.blocked_until && rss.blocked_until > Date.now() / 1000) {
    return { text: 'YOUTUBE BLOCKIERT', cls: 'badge-live', title: 'Bot-Check aktiv' };
  }
  if (rss.running) {
    return { text: rss.processing ? 'VERARBEITET' : 'LÄUFT', cls: 'badge-live', title: '' };
  }
  if (rss.last_error) return { text: 'FEHLER', cls: 'badge-idle', title: rss.last_error };
  return { text: 'BEREIT', cls: 'badge-idle', title: '' };
});

const feeds = computed(() => props.rss?.feeds ?? []);
const counts = computed(() => props.rss?.counts);

function formatTs(ts: number | null | undefined): string {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<template>
  <div class="card">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div class="card-title">RSS-Archiv (rss.app)</div>
      <div class="flex flex-wrap items-center gap-2">
        <span class="badge" :class="badge.cls" :title="badge.title">{{ badge.text }}</span>
        <button type="button" class="btn text-xs" title="Retry-Backoff zurücksetzen" @click="emit('reset')">
          Retries zurücksetzen
        </button>
        <button type="button" class="btn text-xs" @click="emit('backfill')">10 nachholen</button>
        <button type="button" class="btn text-xs" @click="emit('trigger')">Jetzt prüfen</button>
      </div>
    </div>

    <div class="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      <div>
        <div class="stat-label">Feeds</div>
        <div class="stat-value">{{ feeds.length }}</div>
      </div>
      <div>
        <div class="stat-label">Archiviert</div>
        <div class="stat-value text-emerald">{{ counts?.archived ?? 0 }}</div>
      </div>
      <div>
        <div class="stat-label">Übersprungen</div>
        <div class="stat-value">{{ counts?.skipped ?? 0 }}</div>
      </div>
      <div>
        <div class="stat-label" title="Retry, Live-Warteschlange und endgültige Fehler">
          Wartet / Fehler
        </div>
        <div class="stat-value text-rose">
          {{ (counts?.failed ?? 0) + (counts?.retry ?? 0) + (counts?.live ?? 0) }}
        </div>
      </div>
      <div>
        <div class="stat-label">Letzter Lauf</div>
        <div class="text-sm font-semibold">{{ formatTs(rss?.last_poll_finished) }}</div>
      </div>
    </div>

    <div v-if="feeds.length === 0" class="rounded-lg border border-card-border px-3 py-3 text-sm text-muted">
      Keine RSS-Feeds geladen – bitte RSS_FEED_URLS bzw. OPML-Quelle prüfen.
    </div>

    <div v-else class="divide-y divide-card-border/60">
      <div
        v-for="feed in feeds"
        :key="feed.title + feed.host"
        class="flex items-center justify-between gap-3 py-2"
      >
        <div class="flex min-w-0 items-center gap-2">
          <span
            class="h-2 w-2 shrink-0 rounded-full"
            :class="feed.error ? 'bg-rose' : feed.last_check ? 'bg-emerald' : 'bg-slate-600'"
          ></span>
          <span class="truncate font-semibold">{{ feed.title }}</span>
          <span v-if="feed.bundle" class="text-[0.7rem] text-muted">BUNDLE</span>
        </div>
        <span class="shrink-0 text-right text-xs text-muted">
          {{ feed.error || `${feed.items || 0} Items${feed.last_check ? ' • ' + formatTs(feed.last_check) : ''}` }}
        </span>
      </div>
    </div>
  </div>
</template>

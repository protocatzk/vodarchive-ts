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
  if (!rss || !rss.enabled) return { text: 'GESCHLOSSEN', cls: 'stamp-muted', title: '' };
  if (rss.cookies?.broken) {
    return {
      text: 'ZUGANG UNGÜLTIG',
      cls: 'stamp-red',
      title: rss.cookies.reason || 'Cookie-Datei ersetzen und Retries zurücksetzen',
    };
  }
  if (rss.blocked_until && rss.blocked_until > Date.now() / 1000) {
    return { text: 'GESPERRT', cls: 'stamp-red', title: 'Bot-Check aktiv' };
  }
  if (rss.running) {
    return { text: rss.processing ? 'IN ARBEIT' : 'LÄUFT', cls: 'stamp-brass', title: '' };
  }
  if (rss.last_error) return { text: 'FEHLER', cls: 'stamp-red', title: rss.last_error };
  return { text: 'OFFEN', cls: 'stamp-green', title: '' };
});

const feeds = computed(() => props.rss?.feeds ?? []);
const counts = computed(() => props.rss?.counts);

function formatTs(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
</script>

<template>
  <div>
    <div class="sheet-head">
      <div class="sheet-title">Zugangsbuch · rss.app</div>
      <div class="flex flex-wrap items-center gap-2">
        <span class="stamp" :class="badge.cls" :title="badge.title">{{ badge.text }}</span>
        <button type="button" class="btn" title="Retry-Backoff zurücksetzen" @click="emit('reset')">
          Retries zurücksetzen
        </button>
        <button type="button" class="btn" @click="emit('backfill')">10 nachholen</button>
        <button type="button" class="btn btn-primary" @click="emit('trigger')">Jetzt prüfen</button>
      </div>
    </div>

    <div class="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
      <div class="border p-2" style="border-color: var(--rule)">
        <div class="stat-label">Feeds</div>
        <div class="stat-value" style="font-size: 1.4rem">{{ feeds.length }}</div>
      </div>
      <div class="border p-2" style="border-color: var(--rule)">
        <div class="stat-label">Archiviert</div>
        <div class="stat-value" style="font-size: 1.4rem; color: var(--sage)">{{ counts?.archived ?? 0 }}</div>
      </div>
      <div class="border p-2" style="border-color: var(--rule)">
        <div class="stat-label">Übersprungen</div>
        <div class="stat-value" style="font-size: 1.4rem">{{ counts?.skipped ?? 0 }}</div>
      </div>
      <div class="border p-2" style="border-color: var(--rule)">
        <div class="stat-label" title="Retry, Live-Warteschlange und endgültige Fehler">Wartet / Fehler</div>
        <div class="stat-value" style="font-size: 1.4rem; color: var(--oxblood)">
          {{ (counts?.failed ?? 0) + (counts?.retry ?? 0) + (counts?.live ?? 0) }}
        </div>
      </div>
      <div class="border p-2" style="border-color: var(--rule)">
        <div class="stat-label">Letzter Lauf</div>
        <div class="typewriter text-xs mt-1" style="color: var(--ink-soft)">{{ formatTs(rss?.last_poll_finished) }}</div>
      </div>
    </div>

    <div v-if="feeds.length === 0" class="border px-3 py-3 text-sm italic" style="border-color: var(--rule); color: var(--ink-faint)">
      Keine Feeds.
    </div>

    <div v-else>
      <div v-for="feed in feeds" :key="feed.title + feed.host" class="rss-row">
        <div class="flex min-w-0 items-center gap-3">
          <span
            class="rss-dot"
            :class="feed.error ? 'rss-dot-error' : feed.last_check ? 'rss-dot-ok' : 'rss-dot-idle'"
          ></span>
          <span class="truncate font-display font-semibold">{{ feed.title }}</span>
          <span v-if="feed.bundle" class="meta">BUNDLE</span>
        </div>
        <span class="typewriter text-[0.62rem] text-right" style="color: var(--ink-faint)">
          {{ feed.error || `${feed.items || 0} Items${feed.last_check ? ' · ' + formatTs(feed.last_check) : ''}` }}
        </span>
      </div>
    </div>
  </div>
</template>

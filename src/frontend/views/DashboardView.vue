<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import AppHeader from '../components/AppHeader.vue';
import StatsGrid from '../components/StatsGrid.vue';
import RssCard from '../components/RssCard.vue';
import N8nCard from '../components/N8nCard.vue';
import ActiveJobCard from '../components/ActiveJobCard.vue';
import QueueCard from '../components/QueueCard.vue';
import HistoryTable from '../components/HistoryTable.vue';
import LiveLogConsole from '../components/LiveLogConsole.vue';
import { useAuthStore } from '../stores/auth';
import { useDashboardStore } from '../stores/dashboard';
import { useToast } from '../composables/useToast';

const auth = useAuthStore();
const dashboard = useDashboardStore();
const router = useRouter();
const { show } = useToast();

const snap = computed(() => dashboard.snapshot);
const user = computed(() => snap.value?.user || auth.user || 'Admin');

onMounted(async () => {
  const ok = await dashboard.fetchStatus();
  if (!ok) {
    await auth.fetchSession();
    router.push('/login');
    return;
  }
  dashboard.connect();
});

onUnmounted(() => dashboard.disconnect());

async function cancel(key: string): Promise<void> {
  if (!key) return;
  if (!window.confirm('Job wirklich abbrechen?\nBereits nach Telegram hochgeladene Teile werden wieder gelöscht.')) {
    return;
  }
  try {
    const status = await dashboard.cancelJob(key);
    show(status === 'cancelling' ? 'Abbruch wird eingeleitet…' : 'Job abgebrochen.', 'success');
  } catch (error) {
    show((error as Error).message, 'error');
  }
}

async function triggerRss(): Promise<void> {
  const status = await dashboard.triggerRss();
  if (status === 'started') show('RSS-Prüfung gestartet.', 'success');
  else if (status === 'busy') show('RSS-Prüfung läuft bereits.', 'info');
  else show('RSS-Prüfung nicht verfügbar.', 'error');
}

async function backfillRss(): Promise<void> {
  const status = await dashboard.backfillRss();
  if (status === 'started') show('Backfill (10) gestartet.', 'success');
  else if (status === 'busy') show('RSS-Prüfung läuft bereits.', 'info');
  else show('Backfill nicht verfügbar.', 'error');
}

async function resetRss(): Promise<void> {
  try {
    const result = await dashboard.resetRss();
    show(`${result.reset ?? 0} Retry-Eintrag/Einträge zurückgesetzt.`, 'success');
  } catch (error) {
    show((error as Error).message, 'error');
  }
}

async function clearHistory(): Promise<void> {
  if (!window.confirm('Verlauf wirklich leeren? Die Einträge werden dauerhaft gelöscht.')) return;
  try {
    const removed = await dashboard.clearHistory();
    show(`${removed} Eintrag/Einträge gelöscht.`, 'success');
  } catch (error) {
    show((error as Error).message, 'error');
  }
}

async function runN8n(name: string): Promise<void> {
  const status = await dashboard.triggerN8n(name);
  if (status === 'started') show(`n8n-Workflow '${name}' gestartet.`, 'success');
  else if (status === 'disabled') show('n8n ist nicht konfiguriert.', 'error');
  else show(`n8n-Workflow '${name}': ${status}`, 'error');
}
</script>

<template>
  <div class="page">
    <AppHeader :user="user" :connected="dashboard.connected" />

    <h1 class="page-title mb-0">voduploader</h1>
    <p class="page-subtitle text-xs">Archivierung von Stream-VODs – Dashboard</p>

    <div v-if="!snap" class="card card-body mt-6 py-16 text-center text-muted">Lade Dashboard-Daten…</div>

    <template v-else>
      <StatsGrid
        class="mt-6"
        :queue-count="snap.queue_count"
        :topic-count="snap.topic_count"
        :connected="dashboard.connected"
      />

      <div class="mt-6 space-y-6">
        <RssCard :rss="snap.rss" @trigger="triggerRss" @backfill="backfillRss" @reset="resetRss" />

        <N8nCard :workflows="snap.n8n_workflows" @run="runN8n" />

        <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ActiveJobCard :job="snap.active_job" :connected="dashboard.connected" @cancel="cancel" />
          <QueueCard :queue="snap.queue" @cancel="cancel" />
        </div>

        <HistoryTable :history="snap.history" @clear="clearHistory" />
        <LiveLogConsole :logs="snap.logs" />
      </div>
    </template>
  </div>
</template>

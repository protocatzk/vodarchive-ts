<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppHeader from '../components/AppHeader.vue';
import { useAuthStore } from '../stores/auth';
import { useDashboardStore } from '../stores/dashboard';
import { useSourcesStore } from '../stores/sources';
import { useToast } from '../composables/useToast';
import { errorMessage } from '../lib/api';
import type { SourceType } from '../types';

const auth = useAuthStore();
const dashboard = useDashboardStore();
const store = useSourcesStore();
const router = useRouter();
const { show } = useToast();

const newName = ref('');
const newType = ref<SourceType>('rss');
const newUrl = ref('');
const newInterval = ref<number | ''>('');
const adding = ref(false);
const testResult = ref<string>('');
const testing = ref(false);

onMounted(async () => {
  const authed = await auth.fetchSession();
  if (!authed) {
    router.push('/login');
    return;
  }
  try {
    await store.load();
  } catch (error) {
    show(errorMessage(error), 'error');
  }
});

function formatTs(ts: number | null): string {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function runTest(): Promise<void> {
  if (!newUrl.value.trim()) {
    show('Bitte eine URL eingeben.', 'error');
    return;
  }
  testing.value = true;
  testResult.value = '';
  try {
    const result = await store.test(newType.value, newUrl.value.trim());
    testResult.value = result.ok
      ? `OK – ${result.feeds} Feed(s), ${result.items} Item(s) gefunden.`
      : `Fehler: ${result.error ?? 'unbekannt'}`;
    show(result.ok ? 'Quelle erreichbar.' : 'Quelle fehlgeschlagen.', result.ok ? 'success' : 'error');
  } finally {
    testing.value = false;
  }
}

async function add(): Promise<void> {
  if (!newUrl.value.trim()) {
    show('Bitte eine URL eingeben.', 'error');
    return;
  }
  adding.value = true;
  try {
    await store.add({
      name: newName.value.trim(),
      type: newType.value,
      url: newUrl.value.trim(),
      pollIntervalSeconds: newInterval.value === '' ? null : Number(newInterval.value),
    });
    show('Quelle hinzugefügt.', 'success');
    newName.value = '';
    newUrl.value = '';
    newInterval.value = '';
    testResult.value = '';
  } catch (error) {
    show(errorMessage(error), 'error');
  } finally {
    adding.value = false;
  }
}

async function toggle(id: string, enabled: boolean): Promise<void> {
  try {
    await store.update(id, { enabled: !enabled });
  } catch (error) {
    show(errorMessage(error), 'error');
  }
}

async function check(id: string): Promise<void> {
  const status = await store.check(id);
  if (status === 'started') show('Prüfung gestartet.', 'success');
  else if (status === 'busy') show('RSS-Prüfung läuft bereits.', 'info');
  else show(`Prüfung: ${status}`, 'error');
}

async function remove(id: string): Promise<void> {
  if (!window.confirm('Quelle wirklich löschen?')) return;
  try {
    await store.remove(id);
    show('Quelle gelöscht.', 'success');
  } catch (error) {
    show(errorMessage(error), 'error');
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6">
    <AppHeader :user="auth.user || 'Admin'" :connected="dashboard.connected" />

    <div class="mb-6">
      <h1 class="text-2xl font-bold">Quellen</h1>
      <p class="mt-1 text-sm text-muted">
        RSS-Feeds und OPML-Listen. Neue Quellen werden beim nächsten Poll automatisch verarbeitet.
      </p>
    </div>

    <div class="card mb-6">
      <div class="mb-3 card-title">Quelle hinzufügen</div>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-6 lg:items-end">
        <label class="block lg:col-span-2">
          <span class="stat-label mb-1 block">Name</span>
          <input v-model="newName" class="input" placeholder="z. B. MontanaBlack" />
        </label>
        <label class="block">
          <span class="stat-label mb-1 block">Typ</span>
          <select v-model="newType" class="input">
            <option value="rss">RSS</option>
            <option value="opml">OPML</option>
            <option value="ytdlp">yt-dlp (Kanal/Playlist)</option>
          </select>
        </label>
        <label class="block lg:col-span-2">
          <span class="stat-label mb-1 block">URL / Pfad</span>
          <input v-model="newUrl" class="input" placeholder="https://…/feed.xml" />
        </label>
        <label class="block">
          <span class="stat-label mb-1 block">Intervall (s)</span>
          <input v-model="newInterval" type="number" min="60" class="input" placeholder="global" />
        </label>
        <div class="flex flex-wrap gap-2 lg:col-span-6">
          <button type="button" class="btn" :disabled="testing" @click="runTest">
            {{ testing ? 'Teste…' : 'Testen' }}
          </button>
          <button type="button" class="btn btn-primary" :disabled="adding" @click="add">
            {{ adding ? 'Füge hinzu…' : 'Hinzufügen' }}
          </button>
          <span v-if="testResult" class="self-center text-xs text-muted">{{ testResult }}</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="mb-4 flex items-center justify-between">
        <div class="card-title">Konfigurierte Quellen</div>
        <span class="text-xs text-muted">{{ store.sources.length }} Quelle(n)</span>
      </div>

      <div v-if="store.sources.length === 0" class="py-8 text-center text-sm text-muted">
        Noch keine Quellen. Füge oben eine RSS- oder OPML-Quelle hinzu.
      </div>

      <div v-else class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-card-border text-xs uppercase tracking-wide text-muted">
              <th class="py-2 pr-4 font-medium">Name</th>
              <th class="py-2 pr-4 font-medium">Typ</th>
              <th class="py-2 pr-4 font-medium">URL</th>
              <th class="py-2 pr-4 font-medium">Intervall</th>
              <th class="py-2 pr-4 font-medium">Letzte Prüfung</th>
              <th class="py-2 pr-4 font-medium">Archiviert</th>
              <th class="py-2 font-medium">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="source in store.sources"
              :key="source.id"
              class="border-b border-card-border/50 last:border-0"
            >
              <td class="py-3 pr-4 font-semibold text-slate-100">
                {{ source.name }}
                <span v-if="!source.enabled" class="ml-2 text-xs text-amber">deaktiviert</span>
              </td>
              <td class="py-3 pr-4 uppercase text-xs text-cyan">{{ source.type }}</td>
              <td class="max-w-[22rem] truncate py-3 pr-4 text-muted" :title="source.url">
                {{ source.url }}
              </td>
              <td class="py-3 pr-4">{{ source.pollIntervalSeconds ? `${source.pollIntervalSeconds}s` : 'global' }}</td>
              <td class="py-3 pr-4">
                <div>{{ formatTs(source.lastCheck) }}</div>
                <div v-if="source.lastError" class="text-xs text-rose" :title="source.lastError">
                  {{ source.lastError }}
                </div>
                <div v-else-if="source.lastOk" class="text-xs text-emerald">
                  {{ source.lastItems }} Item(s)
                </div>
              </td>
              <td class="py-3 pr-4">{{ source.archivedCount }}</td>
              <td class="py-3">
                <div class="flex flex-wrap gap-2">
                  <button type="button" class="btn text-xs" @click="check(source.id)">Prüfen</button>
                  <button type="button" class="btn text-xs" @click="toggle(source.id, source.enabled)">
                    {{ source.enabled ? 'Deaktivieren' : 'Aktivieren' }}
                  </button>
                  <button type="button" class="btn btn-danger text-xs" @click="remove(source.id)">
                    Löschen
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

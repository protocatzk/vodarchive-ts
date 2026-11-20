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
const testResult = ref('');
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
  if (!ts) return '—';
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
      ? `OK – ${result.feeds} Zugang/Zugänge, ${result.items} Einträge gefunden.`
      : `Fehler: ${result.error ?? 'unbekannt'}`;
    show(result.ok ? 'Zugang erreichbar.' : 'Zugang fehlgeschlagen.', result.ok ? 'success' : 'error');
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
    show('Zugang eingetragen.', 'success');
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
  else if (status === 'busy') show('Prüfung läuft bereits.', 'info');
  else show(`Prüfung: ${status}`, 'error');
}

async function remove(id: string): Promise<void> {
  if (!window.confirm('Zugang wirklich löschen?')) return;
  try {
    await store.remove(id);
    show('Zugang gelöscht.', 'success');
  } catch (error) {
    show(errorMessage(error), 'error');
  }
}
</script>

<template>
  <div class="folio">
    <AppHeader :user="auth.user || 'Admin'" :connected="dashboard.connected" />

    <h1 class="page-title">Zugänge</h1>
    <p class="page-subtitle">RSS-Feeds, OPML-Listen und yt-dlp-Kanäle des Archivs.</p>

    <section class="sheet mb-6">
      <div class="sheet-tab">Neuer Zugang</div>
      <div class="sheet-head">
        <div class="sheet-title">Quelle hinzufügen</div>
        <span class="meta">Zugangsverzeichnis</span>
      </div>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-6 lg:items-end">
        <label class="lg:col-span-2">
          <span class="form-label">Name</span>
          <input v-model="newName" class="input" placeholder="z. B. MontanaBlack" />
        </label>
        <label>
          <span class="form-label">Typ</span>
          <select v-model="newType" class="input">
            <option value="rss">RSS</option>
            <option value="opml">OPML</option>
            <option value="ytdlp">yt-dlp (Kanal/Playlist)</option>
          </select>
        </label>
        <label class="lg:col-span-2">
          <span class="form-label">URL / Pfad</span>
          <input v-model="newUrl" class="input" placeholder="https://…/feed.xml" />
        </label>
        <label>
          <span class="form-label">Intervall (s)</span>
          <input v-model="newInterval" type="number" min="60" class="input" placeholder="global" />
        </label>
        <div class="flex flex-wrap items-center gap-2 lg:col-span-6">
          <button type="button" class="btn" :disabled="testing" @click="runTest">
            {{ testing ? 'Prüfe …' : 'Prüfen' }}
          </button>
          <button type="button" class="btn btn-primary" :disabled="adding" @click="add">
            {{ adding ? 'Wird eingetragen …' : 'Eintragen' }}
          </button>
          <span v-if="testResult" class="meta">{{ testResult }}</span>
        </div>
      </div>
    </section>

    <section class="sheet">
      <div class="sheet-tab">Verzeichnis</div>
      <div class="sheet-head">
        <div class="sheet-title">Konfigurierte Zugänge</div>
        <span class="meta">{{ store.sources.length }} Einträge</span>
      </div>

      <div v-if="store.sources.length === 0" class="py-12 text-center italic" style="color: var(--ink-faint)">
        Noch keine Zugänge – trage oben eine RSS-, OPML- oder yt-dlp-Quelle ein.
      </div>

      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th class="min-w-[11rem]">Name</th>
              <th>Typ</th>
              <th class="min-w-[18rem]">URL</th>
              <th>Intervall</th>
              <th class="min-w-[10rem]">Prüfung</th>
              <th>Archiviert</th>
              <th class="min-w-[16rem]">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="source in store.sources" :key="source.id">
              <td>
                <div class="font-display font-semibold">{{ source.name }}</div>
                <div v-if="!source.enabled" class="meta" style="color: var(--oxblood)">gesperrt</div>
              </td>
              <td class="typewriter text-[0.62rem] uppercase" style="color: var(--brass)">{{ source.type }}</td>
              <td class="typewriter text-[0.62rem] max-w-[22rem] truncate" style="color: var(--ink-faint)" :title="source.url">
                {{ source.url }}
              </td>
              <td class="typewriter text-xs">{{ source.pollIntervalSeconds ? `${source.pollIntervalSeconds}s` : 'global' }}</td>
              <td>
                <div class="typewriter text-[0.62rem]" style="color: var(--ink-faint)">{{ formatTs(source.lastCheck) }}</div>
                <div v-if="source.lastError" class="typewriter text-[0.6rem]" style="color: var(--oxblood)" :title="source.lastError">
                  {{ source.lastError }}
                </div>
                <div v-else-if="source.lastOk" class="typewriter text-[0.6rem]" style="color: var(--sage)">
                  {{ source.lastItems }} Einträge
                </div>
              </td>
              <td class="font-display">{{ source.archivedCount }}</td>
              <td>
                <div class="flex flex-wrap gap-2">
                  <button type="button" class="btn" @click="check(source.id)">Prüfen</button>
                  <button type="button" class="btn" @click="toggle(source.id, source.enabled)">
                    {{ source.enabled ? 'Sperren' : 'Öffnen' }}
                  </button>
                  <button type="button" class="btn btn-danger" @click="remove(source.id)">Löschen</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

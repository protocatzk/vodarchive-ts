<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
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
const testSample = ref<Record<string, unknown> | null>(null);
const testing = ref(false);

// Streamrecorder-spezifisch
const newCookie = ref('');
const newTargets = ref('');
const newOnlyNew = ref(true);
const newInitialBackfill = ref(false);
const newListPath = ref('/api/user/recordingsv2');
const newLimit = ref<number | ''>(10);
const newItemsPath = ref('');
const advancedOpen = ref(false);

const isStreamrecorder = computed(() => newType.value === 'streamrecorder');

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

function streamrecorderExtra(): Record<string, unknown> {
  return {
    cookie: newCookie.value.trim(),
    apiBaseUrl: newUrl.value.trim() || 'https://streamrecorder.io',
    listPath: newListPath.value.trim() || '/api/user/recordingsv2',
    limit: Number(newLimit.value) || 10,
    itemsPath: newItemsPath.value.trim(),
    targets: newTargets.value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
    initialBackfill: newInitialBackfill.value,
    onlyNew: newOnlyNew.value,
  };
}

async function runTest(): Promise<void> {
  if (isStreamrecorder.value) {
    if (!newCookie.value.trim()) {
      show('Bitte den Streamrecorder-Cookie eingeben.', 'error');
      return;
    }
  } else if (!newUrl.value.trim()) {
    show('Bitte eine URL eingeben.', 'error');
    return;
  }
  testing.value = true;
  testResult.value = '';
  testSample.value = null;
  try {
    const result = await store.test(
      newType.value,
      newUrl.value.trim() || 'https://streamrecorder.io',
      isStreamrecorder.value ? streamrecorderExtra() : {},
    );
    testResult.value = result.ok
      ? `OK – ${result.targets ?? '?'} Target(s), ${result.total ?? result.items} Aufnahme(n), ${result.items} übernehmbar.`
      : `Fehler: ${result.error ?? 'unbekannt'}`;
    testSample.value = result.sample ?? null;
    show(result.ok ? 'Zugang erreichbar.' : 'Zugang fehlgeschlagen.', result.ok ? 'success' : 'error');
  } finally {
    testing.value = false;
  }
}

async function add(): Promise<void> {
  if (!isStreamrecorder.value && !newUrl.value.trim()) {
    show('Bitte eine URL eingeben.', 'error');
    return;
  }
  if (isStreamrecorder.value && !newCookie.value.trim()) {
    show('Bitte den Streamrecorder-Cookie eingeben.', 'error');
    return;
  }
  adding.value = true;
  try {
    await store.add({
      name: newName.value.trim(),
      type: newType.value,
      url: newUrl.value.trim() || (isStreamrecorder.value ? 'https://streamrecorder.io' : ''),
      pollIntervalSeconds: newInterval.value === '' ? null : Number(newInterval.value),
      ...(isStreamrecorder.value ? streamrecorderExtra() : {}),
    });
    show('Zugang eingetragen.', 'success');
    newName.value = '';
    newUrl.value = '';
    newInterval.value = '';
    newCookie.value = '';
    newTargets.value = '';
    newOnlyNew.value = true;
    newInitialBackfill.value = false;
    newListPath.value = '/api/user/recordingsv2';
    newLimit.value = 10;
    newItemsPath.value = '';
    testResult.value = '';
    testSample.value = null;
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
    <p class="page-subtitle">
      RSS-Feeds, OPML-Listen, yt-dlp-Kanäle und Streamrecorder-Aufnahmen des Archivs.
    </p>

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
            <option value="streamrecorder">Streamrecorder</option>
          </select>
        </label>
        <label class="lg:col-span-2">
          <span class="form-label">{{ isStreamrecorder ? 'API-Basis' : 'URL / Pfad' }}</span>
          <input
            v-model="newUrl"
            class="input"
            :placeholder="isStreamrecorder ? 'https://streamrecorder.io' : 'https://…/feed.xml'"
          />
        </label>
        <label>
          <span class="form-label">Intervall (s)</span>
          <input v-model="newInterval" type="number" min="60" class="input" placeholder="global" />
        </label>

        <template v-if="isStreamrecorder">
          <label class="md:col-span-2 lg:col-span-3">
            <span class="form-label">Streamrecorder-Cookie</span>
            <input
              v-model="newCookie"
              type="password"
              class="input"
              placeholder="Cookie-Header (wird nicht ausgeliefert)"
            />
          </label>
          <label class="md:col-span-2 lg:col-span-2">
            <span class="form-label">Targets (kommagetrennt, optional)</span>
            <input v-model="newTargets" class="input" placeholder="Ripper, Karpfen" />
          </label>
          <label class="form-check">
            <input v-model="newOnlyNew" type="checkbox" />
            Nur neue (nicht heruntergeladene)
          </label>
          <label class="form-check">
            <input v-model="newInitialBackfill" type="checkbox" />
            Bestand beim ersten Lauf übernehmen
          </label>
          <button
            type="button"
            class="btn btn-ghost lg:col-span-1"
            @click="advancedOpen = !advancedOpen"
          >
            {{ advancedOpen ? 'Weniger' : 'Erweitert' }}
          </button>
          <template v-if="advancedOpen">
            <label class="md:col-span-2 lg:col-span-2">
              <span class="form-label">Listen-Pfad</span>
              <input v-model="newListPath" class="input" placeholder="/api/user/recordingsv2" />
            </label>
            <label>
              <span class="form-label">Limit / Target</span>
              <input v-model="newLimit" type="number" min="1" max="100" class="input" />
            </label>
            <label class="md:col-span-2 lg:col-span-2">
              <span class="form-label">Items-Pfad in JSON (optional)</span>
              <input v-model="newItemsPath" class="input" placeholder="z. B. data" />
            </label>
          </template>
        </template>

        <div class="flex flex-wrap items-center gap-2 lg:col-span-6">
          <button type="button" class="btn" :disabled="testing" @click="runTest">
            {{ testing ? 'Prüfe …' : 'Prüfen' }}
          </button>
          <button type="button" class="btn btn-primary" :disabled="adding" @click="add">
            {{ adding ? 'Wird eingetragen …' : 'Eintragen' }}
          </button>
          <span v-if="testResult" class="meta">{{ testResult }}</span>
        </div>
        <div v-if="testSample" class="md:col-span-2 lg:col-span-6">
          <div class="form-label">Erkannte Felder der ersten Aufnahme</div>
          <div class="rounded border p-2 font-mono text-xs" style="border-color: var(--rule); color: var(--ink-soft)">
            {{ Object.keys(testSample).join(', ') }}
          </div>
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
        Noch keine Zugänge – trage oben eine RSS-, OPML-, yt-dlp- oder Streamrecorder-Quelle ein.
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
                <div class="flex flex-wrap gap-1">
                  <span v-if="!source.enabled" class="meta" style="color: var(--oxblood)">gesperrt</span>
                  <span v-if="source.cookieSet" class="chip">Cookie gesetzt</span>
                </div>
              </td>
              <td class="typewriter text-[0.62rem] uppercase" style="color: var(--brass)">
                {{ source.type }}
              </td>
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

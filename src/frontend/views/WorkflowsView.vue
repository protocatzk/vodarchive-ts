<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppHeader from '../components/AppHeader.vue';
import { useAuthStore } from '../stores/auth';
import { useDashboardStore } from '../stores/dashboard';
import { useWorkflowsStore } from '../stores/workflows';
import { useToast } from '../composables/useToast';
import { errorMessage } from '../lib/api';

const auth = useAuthStore();
const dashboard = useDashboardStore();
const store = useWorkflowsStore();
const router = useRouter();
const { show } = useToast();

const newName = ref('');
const newUrl = ref('');
const newInterval = ref<number | ''>('');
const adding = ref(false);
const runningId = ref('');

onMounted(async () => {
  const authed = await auth.fetchSession();
  if (!authed) {
    router.push('/login');
    return;
  }
  try {
    await store.load();
    await store.checkN8n();
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

function statusClass(status: string | null): string {
  if (status === 'ok') return 'stamp-green';
  if (status === 'timeout' || status === 'cooldown') return 'stamp-brass';
  if (status === 'failed') return 'stamp-red';
  return 'stamp-muted';
}

async function add(): Promise<void> {
  if (!newName.value.trim() || !newUrl.value.trim()) {
    show('Bitte Name und Webhook-URL angeben.', 'error');
    return;
  }
  adding.value = true;
  try {
    await store.add({
      name: newName.value.trim(),
      webhookUrl: newUrl.value.trim(),
      intervalSeconds: newInterval.value === '' ? 0 : Number(newInterval.value),
    });
    show('Vorgang eingetragen.', 'success');
    newName.value = '';
    newUrl.value = '';
    newInterval.value = '';
  } catch (error) {
    show(errorMessage(error), 'error');
  } finally {
    adding.value = false;
  }
}

async function run(id: string, name: string): Promise<void> {
  runningId.value = id;
  try {
    const result = await store.run(id);
    if (result.status === 'ok') show(`Vorgang '${name}' ausgelöst.`, 'success');
    else if (result.status === 'cooldown') show('Sperrfrist aktiv oder läuft bereits.', 'info');
    else show(`Vorgang '${name}': ${result.error ?? result.status}`, 'error');
  } finally {
    runningId.value = '';
  }
}

async function toggle(id: string, enabled: boolean): Promise<void> {
  try {
    await store.update(id, { enabled: !enabled });
  } catch (error) {
    show(errorMessage(error), 'error');
  }
}

async function setInterval(id: string, value: string): Promise<void> {
  try {
    await store.update(id, { intervalSeconds: value === '' ? 0 : Number(value) });
    show('Intervall aktualisiert.', 'success');
  } catch (error) {
    show(errorMessage(error), 'error');
  }
}

function onIntervalChange(id: string, event: Event): void {
  void setInterval(id, (event.target as HTMLInputElement).value);
}

async function remove(id: string): Promise<void> {
  if (!window.confirm('Vorgang wirklich löschen?')) return;
  try {
    await store.remove(id);
    show('Vorgang gelöscht.', 'success');
  } catch (error) {
    show(errorMessage(error), 'error');
  }
}

async function discover(): Promise<void> {
  await store.discover();
  if (store.discovered.length > 0) show(`${store.discovered.length} Vorgänge gefunden.`, 'success');
  else if (store.discoverError) show(store.discoverError, 'error');
}

function isImported(workflow: { name: string; webhookUrl: string | null }): boolean {
  return store.workflows.some(
    (local) =>
      local.name === workflow.name ||
      (workflow.webhookUrl !== null && local.webhookUrl === workflow.webhookUrl),
  );
}

async function importOne(id: string, name: string): Promise<void> {
  try {
    const imported = await store.importWorkflow(id);
    show(imported ? `'${name}' übernommen.` : `'${name}' war bereits vorhanden.`, 'success');
  } catch (error) {
    show(errorMessage(error), 'error');
  }
}

async function n8nToggle(id: string, active: boolean): Promise<void> {
  try {
    await store.setActive(id, !active);
    show(active ? 'Vorgang in n8n gesperrt.' : 'Vorgang in n8n freigegeben.', 'success');
  } catch (error) {
    show(errorMessage(error), 'error');
  }
}
</script>

<template>
  <div class="folio">
    <AppHeader :user="auth.user || 'Admin'" :connected="dashboard.connected" />

    <h1 class="page-title">Vorgänge</h1>
    <p class="page-subtitle">
      n8n-Workflows – manuell, zeitgesteuert oder über die n8n-Registratur.
    </p>

    <section class="sheet mb-6">
      <div class="sheet-tab">Neuer Vorgang</div>
      <div class="sheet-head">
        <div class="sheet-title">Workflow hinzufügen</div>
        <span class="meta">Webhook-Register</span>
      </div>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5 lg:items-end">
        <label>
          <span class="form-label">Name</span>
          <input v-model="newName" class="input" placeholder="z. B. Ripper" />
        </label>
        <label class="lg:col-span-2">
          <span class="form-label">Webhook-URL</span>
          <input v-model="newUrl" class="input" placeholder="https://n8n…/webhook/…" />
        </label>
        <label>
          <span class="form-label">Intervall (s, 0 = manuell)</span>
          <input v-model="newInterval" type="number" min="0" class="input" placeholder="0" />
        </label>
        <button type="button" class="btn btn-primary" :disabled="adding" @click="add">
          {{ adding ? 'Wird eingetragen …' : 'Eintragen' }}
        </button>
      </div>
    </section>

    <section class="sheet mb-6">
      <div class="sheet-tab">Registratur</div>
      <div class="sheet-head">
        <div class="sheet-title">n8n-API · Bestandsabgleich</div>
        <div class="flex items-center gap-2">
          <span class="stamp" :class="store.n8nConfigured ? 'stamp-green' : 'stamp-muted'">
            {{ store.n8nConfigured ? 'verbunden' : 'offen' }}
          </span>
          <button type="button" class="btn" :disabled="store.discovering" @click="discover">
            {{ store.discovering ? 'Lade …' : 'Vorgänge laden' }}
          </button>
        </div>
      </div>
      <p class="mb-3 text-sm italic" style="color: var(--ink-soft)">
        Basis-URL und API-Schlüssel in der
        <RouterLink to="/settings" class="topic-link">Ordnung</RouterLink> hinterlegen.
      </p>

      <div v-if="store.discoverError" class="mb-3 border px-3 py-2 text-sm" style="border-color: var(--oxblood); color: var(--oxblood)">
        {{ store.discoverError }}
      </div>

      <div v-if="store.discovered.length > 0" class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th class="min-w-[12rem]">Name</th>
              <th>Status</th>
              <th class="min-w-[18rem]">Webhook</th>
              <th class="min-w-[14rem]">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="workflow in store.discovered" :key="workflow.id">
              <td class="font-display font-semibold">{{ workflow.name }}</td>
              <td>
                <span class="stamp" :class="workflow.active ? 'stamp-green' : 'stamp-muted'">
                  {{ workflow.active ? 'aktiv' : 'inaktiv' }}
                </span>
              </td>
              <td class="typewriter text-[0.62rem] max-w-[22rem] truncate" style="color: var(--ink-faint)" :title="workflow.webhookUrl ?? ''">
                {{ workflow.webhookUrl ?? '— kein Webhook —' }}
              </td>
              <td>
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="btn"
                    :disabled="!workflow.webhookUrl || isImported(workflow)"
                    @click="importOne(workflow.id, workflow.name)"
                  >
                    {{ isImported(workflow) ? 'Übernommen' : 'Übernehmen' }}
                  </button>
                  <button type="button" class="btn" @click="n8nToggle(workflow.id, workflow.active)">
                    {{ workflow.active ? 'Sperren' : 'Freigeben' }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="!store.discovering && !store.discoverError" class="meta">
        Noch kein Bestandsabgleich durchgeführt.
      </div>
    </section>

    <section class="sheet">
      <div class="sheet-tab">Bestand</div>
      <div class="sheet-head">
        <div class="sheet-title">Konfigurierte Vorgänge</div>
        <span class="meta">{{ store.workflows.length }} Einträge</span>
      </div>

      <div v-if="store.workflows.length === 0" class="py-12 text-center italic" style="color: var(--ink-faint)">
        Noch keine Vorgänge eingetragen.
      </div>

      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th class="min-w-[11rem]">Name</th>
              <th class="min-w-[16rem]">Webhook</th>
              <th>Intervall</th>
              <th class="min-w-[9rem]">Letzter Lauf</th>
              <th>Ergebnis</th>
              <th>Läufe</th>
              <th class="min-w-[16rem]">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="workflow in store.workflows" :key="workflow.id">
              <td>
                <div class="font-display font-semibold">{{ workflow.name }}</div>
                <div v-if="!workflow.enabled" class="meta" style="color: var(--oxblood)">gesperrt</div>
              </td>
              <td class="typewriter text-[0.62rem] max-w-[20rem] truncate" style="color: var(--ink-faint)" :title="workflow.webhookUrl">
                {{ workflow.webhookUrl }}
              </td>
              <td>
                <input
                  :value="workflow.intervalSeconds || ''"
                  type="number"
                  min="0"
                  class="input w-24"
                  placeholder="manuell"
                  @change="onIntervalChange(workflow.id, $event)"
                />
              </td>
              <td class="typewriter text-xs">{{ formatTs(workflow.lastRun) }}</td>
              <td>
                <span class="stamp" :class="statusClass(workflow.lastStatus)">
                  {{ workflow.lastStatus ?? 'unbekannt' }}
                </span>
                <div v-if="workflow.lastError" class="typewriter text-[0.58rem] mt-1" style="color: var(--oxblood)" :title="workflow.lastError">
                  {{ workflow.lastError }}
                </div>
              </td>
              <td class="font-display">{{ workflow.runCount }}</td>
              <td>
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="btn btn-primary"
                    :disabled="runningId === workflow.id"
                    @click="run(workflow.id, workflow.name)"
                  >
                    {{ runningId === workflow.id ? 'Läuft …' : 'Auslösen' }}
                  </button>
                  <button type="button" class="btn" @click="toggle(workflow.id, workflow.enabled)">
                    {{ workflow.enabled ? 'Sperren' : 'Freigeben' }}
                  </button>
                  <button type="button" class="btn btn-danger" @click="remove(workflow.id)">Löschen</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

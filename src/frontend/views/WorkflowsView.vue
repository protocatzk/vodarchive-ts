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
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusClass(status: string | null): string {
  if (status === 'ok') return 'text-emerald';
  if (status === 'timeout' || status === 'cooldown') return 'text-amber';
  if (status === 'failed') return 'text-rose';
  return 'text-muted';
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
    show('Workflow hinzugefügt.', 'success');
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
    if (result.status === 'ok') show(`Workflow '${name}' gestartet.`, 'success');
    else if (result.status === 'cooldown') show('Cooldown aktiv oder läuft bereits.', 'info');
    else show(`Workflow '${name}': ${result.error ?? result.status}`, 'error');
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
  if (!window.confirm('Workflow wirklich löschen?')) return;
  try {
    await store.remove(id);
    show('Workflow gelöscht.', 'success');
  } catch (error) {
    show(errorMessage(error), 'error');
  }
}

async function discover(): Promise<void> {
  await store.discover();
  if (store.discovered.length > 0) show(`${store.discovered.length} Workflow(s) gefunden.`, 'success');
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
    show(imported ? `'${name}' importiert.` : `'${name}' war bereits vorhanden.`, 'success');
  } catch (error) {
    show(errorMessage(error), 'error');
  }
}

async function n8nToggle(id: string, active: boolean): Promise<void> {
  try {
    await store.setActive(id, !active);
    show(active ? 'Workflow in n8n deaktiviert.' : 'Workflow in n8n aktiviert.', 'success');
  } catch (error) {
    show(errorMessage(error), 'error');
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6">
    <AppHeader :user="auth.user || 'Admin'" :connected="dashboard.connected" />

    <div class="mb-6">
      <h1 class="text-2xl font-bold">n8n-Workflows</h1>
      <p class="mt-1 text-sm text-muted">
        Workflows per Webhook manuell oder zeitgesteuert starten. n8n (Sustainable Use License)
        darf für den eigenen Betrieb selbst gehostet und ausgeführt werden.
      </p>
    </div>

    <div class="card mb-6">
      <div class="mb-3 card-title">Workflow hinzufügen</div>
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5 lg:items-end">
        <label class="block">
          <span class="stat-label mb-1 block">Name</span>
          <input v-model="newName" class="input" placeholder="z. B. Ripper" />
        </label>
        <label class="block lg:col-span-2">
          <span class="stat-label mb-1 block">Webhook-URL</span>
          <input v-model="newUrl" class="input" placeholder="https://n8n…/webhook/…" />
        </label>
        <label class="block">
          <span class="stat-label mb-1 block">Intervall (s, 0 = manuell)</span>
          <input v-model="newInterval" type="number" min="0" class="input" placeholder="0" />
        </label>
        <button type="button" class="btn btn-primary" :disabled="adding" @click="add">
          {{ adding ? 'Füge hinzu…' : 'Hinzufügen' }}
        </button>
      </div>
    </div>

    <div class="card mb-6">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div class="card-title">n8n-API (Discovery)</div>
        <div class="flex items-center gap-2">
          <span v-if="store.n8nConfigured === false" class="badge badge-idle">nicht verbunden</span>
          <span v-else-if="store.n8nConfigured" class="badge badge-live">verbunden</span>
          <button type="button" class="btn text-xs" :disabled="store.discovering" @click="discover">
            {{ store.discovering ? 'Lade…' : 'Workflows von n8n laden' }}
          </button>
        </div>
      </div>
      <p class="mb-3 text-xs text-muted">
        Base URL und API-Key in den
        <RouterLink to="/settings" class="text-cyan hover:underline">Einstellungen</RouterLink>
        hinterlegen. Importiert Workflows mit Webhook-Trigger in die lokale Liste.
      </p>

      <div
        v-if="store.discoverError"
        class="mb-3 rounded-lg border border-rose/40 bg-rose/10 px-3 py-2 text-xs text-rose"
      >
        {{ store.discoverError }}
      </div>

      <div v-if="store.discovered.length > 0" class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-card-border text-xs uppercase tracking-wide text-muted">
              <th class="py-2 pr-4 font-medium">Name</th>
              <th class="py-2 pr-4 font-medium">Aktiv</th>
              <th class="py-2 pr-4 font-medium">Webhook</th>
              <th class="py-2 font-medium">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="workflow in store.discovered"
              :key="workflow.id"
              class="border-b border-card-border/50 last:border-0"
            >
              <td class="py-2 pr-4 font-semibold text-slate-100">{{ workflow.name }}</td>
              <td class="py-2 pr-4">
                <span class="badge" :class="workflow.active ? 'badge-live' : 'badge-idle'">
                  {{ workflow.active ? 'aktiv' : 'inaktiv' }}
                </span>
              </td>
              <td class="max-w-[22rem] truncate py-2 pr-4 text-muted" :title="workflow.webhookUrl ?? ''">
                {{ workflow.webhookUrl ?? '— kein Webhook —' }}
              </td>
              <td class="py-2">
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="btn text-xs"
                    :disabled="!workflow.webhookUrl || isImported(workflow)"
                    @click="importOne(workflow.id, workflow.name)"
                  >
                    {{ isImported(workflow) ? 'Importiert' : 'Importieren' }}
                  </button>
                  <button type="button" class="btn text-xs" @click="n8nToggle(workflow.id, workflow.active)">
                    {{ workflow.active ? 'Deaktivieren' : 'Aktivieren' }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="!store.discovering && !store.discoverError" class="text-xs text-muted">
        Noch keine Discovery durchgeführt.
      </div>
    </div>

    <div class="card">
      <div class="mb-4 flex items-center justify-between">
        <div class="card-title">Konfigurierte Workflows</div>
        <span class="text-xs text-muted">{{ store.workflows.length }} Workflow(s)</span>
      </div>

      <div v-if="store.workflows.length === 0" class="py-8 text-center text-sm text-muted">
        Noch keine Workflows konfiguriert.
      </div>

      <div v-else class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-card-border text-xs uppercase tracking-wide text-muted">
              <th class="py-2 pr-4 font-medium">Name</th>
              <th class="py-2 pr-4 font-medium">Webhook</th>
              <th class="py-2 pr-4 font-medium">Intervall</th>
              <th class="py-2 pr-4 font-medium">Letzter Lauf</th>
              <th class="py-2 pr-4 font-medium">Status</th>
              <th class="py-2 pr-4 font-medium">Läufe</th>
              <th class="py-2 font-medium">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="workflow in store.workflows"
              :key="workflow.id"
              class="border-b border-card-border/50 last:border-0"
            >
              <td class="py-3 pr-4 font-semibold text-slate-100">
                {{ workflow.name }}
                <span v-if="!workflow.enabled" class="ml-2 text-xs text-amber">deaktiviert</span>
              </td>
              <td class="max-w-[20rem] truncate py-3 pr-4 text-muted" :title="workflow.webhookUrl">
                {{ workflow.webhookUrl }}
              </td>
              <td class="py-3 pr-4">
                <input
                  :value="workflow.intervalSeconds || ''"
                  type="number"
                  min="0"
                  class="input w-24"
                  placeholder="manuell"
                  @change="onIntervalChange(workflow.id, $event)"
                />
              </td>
              <td class="py-3 pr-4">{{ formatTs(workflow.lastRun) }}</td>
              <td class="py-3 pr-4">
                <div class="font-semibold" :class="statusClass(workflow.lastStatus)">
                  {{ workflow.lastStatus ?? '-' }}
                </div>
                <div v-if="workflow.lastError" class="max-w-[16rem] truncate text-xs text-rose" :title="workflow.lastError">
                  {{ workflow.lastError }}
                </div>
              </td>
              <td class="py-3 pr-4">{{ workflow.runCount }}</td>
              <td class="py-3">
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="btn text-xs"
                    :disabled="runningId === workflow.id"
                    @click="run(workflow.id, workflow.name)"
                  >
                    {{ runningId === workflow.id ? 'Startet…' : 'Jetzt starten' }}
                  </button>
                  <button type="button" class="btn text-xs" @click="toggle(workflow.id, workflow.enabled)">
                    {{ workflow.enabled ? 'Deaktivieren' : 'Aktivieren' }}
                  </button>
                  <button type="button" class="btn btn-danger text-xs" @click="remove(workflow.id)">
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

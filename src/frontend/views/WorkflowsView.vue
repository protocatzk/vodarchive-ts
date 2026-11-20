<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppHeader from '../components/AppHeader.vue';
import { useAuthStore } from '../stores/auth';
import { useDashboardStore } from '../stores/dashboard';
import { useSourcesStore } from '../stores/sources';
import { useWorkflowsStore } from '../stores/workflows';
import { useToast } from '../composables/useToast';
import { errorMessage } from '../lib/api';
import type { ExecutionRecord, WorkflowDefinition } from '../types';

const auth = useAuthStore();
const dashboard = useDashboardStore();
const store = useWorkflowsStore();
const sourcesStore = useSourcesStore();
const router = useRouter();
const { show } = useToast();

// Interner Ablauf
const iName = ref('');
const iTrigger = ref<'manual' | 'schedule'>('manual');
const iInterval = ref<number | ''>(900);
const iDefinition = ref('');
const iAdding = ref(false);

// Webhook / n8n
const newName = ref('');
const newUrl = ref('');
const newInterval = ref<number | ''>('');
const adding = ref(false);
const runningId = ref('');

const expandedExec = ref<string | null>(null);
const selectedSource = ref('');
const srSources = computed(() => sourcesStore.sources.filter((source) => source.type === 'streamrecorder'));
const liveWorkflows = computed(() => dashboard.snapshot?.workflows ?? store.workflows);
const liveExecutions = computed(() => dashboard.snapshot?.executions ?? store.executions);
const executionCount = computed(() => liveExecutions.value.length);

const TEMPLATE: WorkflowDefinition = {
  trigger: { type: 'manual' },
  steps: [
    { type: 'log', message: 'Starte Streamrecorder-Lauf' },
    {
      type: 'streamrecorder.recordings',
      sourceId: '<QUELLEN-ID>',
      saveAs: 'items',
    },
    { type: 'filter', where: [{ field: 'url', op: 'exists' }] },
    {
      type: 'foreach',
      path: 'items',
      steps: [
        {
          type: 'enqueue_upload',
          wait: true,
          map: {
            download_url: '{{ item.url }}',
            source: 'streamrecorder',
            use_ytdlp: false,
            recording_id: '{{ item.recordingId }}',
            streamer: '{{ item.streamer }}',
            title: '{{ item.title }}',
            thumbnail_url: '{{ item.thumbnail }}',
            platform: '{{ item.platform }}',
            recorded_at: '{{ item.recordedAt }}',
            sourceId: '<QUELLEN-ID>',
          },
        },
      ],
    },
  ],
};

function loadTemplate(): void {
  const clone = structuredClone(TEMPLATE);
  const placeholder = selectedSource.value || '<QUELLEN-ID>';
  clone.steps = JSON.parse(JSON.stringify(clone.steps).split('<QUELLEN-ID>').join(placeholder));
  clone.trigger.type = iTrigger.value;
  if (iTrigger.value === 'schedule') clone.trigger.intervalSeconds = Number(iInterval.value) || 900;
  iDefinition.value = JSON.stringify(clone, null, 2);
}

onMounted(async () => {
  const authed = await auth.fetchSession();
  if (!authed) {
    router.push('/login');
    return;
  }
  dashboard.ensureConnected();
  try {
    await sourcesStore.load().catch(() => undefined);
    const firstSource = srSources.value[0];
    if (firstSource) selectedSource.value = firstSource.id;
    loadTemplate();
    await store.load();
    await store.checkN8n();
    await store.loadExecutions();
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

function formatDuration(start: number, end: number | null): string {
  const ms = (end ?? Date.now()) - start;
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function statusClass(status: string | null): string {
  if (status === 'ok' || status === 'success') return 'stamp-green';
  if (status === 'timeout' || status === 'cooldown' || status === 'running') return 'stamp-brass';
  if (status === 'failed') return 'stamp-red';
  return 'stamp-muted';
}

function triggerLabel(trigger: { type: string; intervalSeconds?: number } | undefined): string {
  if (!trigger) return '—';
  if (trigger.type === 'schedule') return `alle ${trigger.intervalSeconds ?? 0}s`;
  return 'manuell';
}

async function addInternal(): Promise<void> {
  if (!iName.value.trim()) {
    show('Bitte einen Namen angeben.', 'error');
    return;
  }
  let definition: WorkflowDefinition;
  try {
    definition = JSON.parse(iDefinition.value) as WorkflowDefinition;
  } catch (error) {
    show(`JSON ungültig: ${(error as Error).message}`, 'error');
    return;
  }
  definition.trigger = {
    type: iTrigger.value,
    ...(iTrigger.value === 'schedule'
      ? { intervalSeconds: Number(iInterval.value) || 900 }
      : {}),
  };
  iAdding.value = true;
  try {
    await store.add({ name: iName.value.trim(), kind: 'internal', definition });
    show('Interner Vorgang angelegt.', 'success');
    iName.value = '';
  } catch (error) {
    show(errorMessage(error), 'error');
  } finally {
    iAdding.value = false;
  }
}

async function addWebhook(): Promise<void> {
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
    show('Webhook-Vorgang eingetragen.', 'success');
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
    if (result.status === 'ok') show(`Vorgang '${name}' ausgeführt.`, 'success');
    else if (result.status === 'cooldown') show('Sperrfrist aktiv oder läuft bereits.', 'info');
    else show(`Vorgang '${name}': ${result.error ?? result.status}`, 'error');
    await store.loadExecutions();
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
  return liveWorkflows.value.some(
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

function toggleExec(id: string): void {
  expandedExec.value = expandedExec.value === id ? null : id;
}

async function clearExecutions(): Promise<void> {
  if (!window.confirm('Ausführungsprotokoll wirklich leeren?')) return;
  try {
    const removed = await store.clearExecutions();
    show(`${removed} Ausführung(en) gelöscht.`, 'success');
    expandedExec.value = null;
  } catch (error) {
    show(errorMessage(error), 'error');
  }
}

</script>

<template>
  <div class="folio">
    <AppHeader :user="auth.user || 'Admin'" :connected="dashboard.connected" />

    <h1 class="page-title">Vorgänge</h1>

    <!-- Interner Ablauf -->
    <section class="sheet mb-6">
      <div class="sheet-tab">Interner Ablauf</div>
      <div class="sheet-head">
        <div class="sheet-title">Neuer Vorgang</div>
        <span class="meta">JSON-Workflow</span>
      </div>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4 lg:items-end">
        <label>
          <span class="form-label">Name</span>
          <input v-model="iName" class="input" placeholder="z. B. Streamrecorder Ripper" />
        </label>
        <label>
          <span class="form-label">Trigger</span>
          <select v-model="iTrigger" class="input">
            <option value="manual">Manuell</option>
            <option value="schedule">Zeitplan</option>
          </select>
        </label>
        <label v-if="iTrigger === 'schedule'">
          <span class="form-label">Intervall (s)</span>
          <input v-model="iInterval" type="number" min="60" class="input" />
        </label>
        <label v-if="srSources.length">
          <span class="form-label">Streamrecorder-Quelle</span>
          <select v-model="selectedSource" class="input" @change="loadTemplate">
            <option v-for="source in srSources" :key="source.id" :value="source.id">
              {{ source.name }}
            </option>
          </select>
        </label>
        <button type="button" class="btn" @click="loadTemplate">Vorlage laden</button>
      </div>

      <label class="mt-3 block">
        <span class="form-label">Definition (JSON)</span>
        <textarea
          v-model="iDefinition"
          rows="16"
          class="input"
          style="font-family: var(--font-mono); font-size: 0.75rem; line-height: 1.5"
          spellcheck="false"
        ></textarea>
      </label>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" class="btn btn-primary" :disabled="iAdding" @click="addInternal">
          {{ iAdding ? 'Wird angelegt …' : 'Internen Vorgang anlegen' }}
        </button>
      </div>
    </section>

    <!-- Webhook / n8n -->
    <section class="sheet mb-6">
      <div class="sheet-tab">Extern / n8n</div>
      <div class="sheet-head">
        <div class="sheet-title">Webhook-Vorgang</div>
        
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
        <button type="button" class="btn" :disabled="adding" @click="addWebhook">
          {{ adding ? 'Wird eingetragen …' : 'Eintragen' }}
        </button>
      </div>
    </section>

    <!-- n8n Discovery -->
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
                  <button type="button" class="btn" :disabled="!workflow.webhookUrl || isImported(workflow)" @click="importOne(workflow.id, workflow.name)">
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
        Kein Bestandsabgleich.
      </div>
    </section>

    <!-- Bestand -->
    <section class="sheet mb-6">
      <div class="sheet-tab">Bestand</div>
      <div class="sheet-head">
        <div class="sheet-title">Konfigurierte Vorgänge</div>
        <span class="meta">{{ liveWorkflows.length }} Einträge</span>
      </div>

      <div v-if="liveWorkflows.length === 0" class="py-12 text-center italic" style="color: var(--ink-faint)">
        Keine Vorgänge.
      </div>

      <div v-else class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th class="min-w-[12rem]">Name</th>
              <th>Art</th>
              <th>Auslöser</th>
              <th class="min-w-[9rem]">Letzter Lauf</th>
              <th>Ergebnis</th>
              <th>Läufe</th>
              <th class="min-w-[15rem]">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="workflow in liveWorkflows" :key="workflow.id">
              <td>
                <div class="font-display font-semibold">{{ workflow.name }}</div>
                <div v-if="!workflow.enabled" class="meta" style="color: var(--oxblood)">gesperrt</div>
              </td>
              <td>
                <span class="chip">{{ workflow.kind === 'internal' ? 'intern' : 'webhook' }}</span>
              </td>
              <td class="typewriter text-xs">
                {{ workflow.definition ? triggerLabel(workflow.definition.trigger) : workflow.trigger ? triggerLabel(workflow.trigger) : workflow.intervalSeconds ? `alle ${workflow.intervalSeconds}s` : 'manuell' }}
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
                  <button type="button" class="btn btn-primary" :disabled="runningId === workflow.id" @click="run(workflow.id, workflow.name)">
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

    <!-- Ausführungen -->
    <section class="sheet">
      <div class="sheet-tab">Ausführungen</div>
      <div class="sheet-head">
        <div class="sheet-title">Protokoll</div>
        <div class="flex items-center gap-2">
          <span class="meta">{{ executionCount }} Einträge</span>
          <button type="button" class="btn" :disabled="executionCount === 0" @click="clearExecutions">
            Leeren
          </button>
        </div>
      </div>

      <div v-if="liveExecutions.length === 0" class="py-8 text-center italic" style="color: var(--ink-faint)">
        Keine Ausführungen.
      </div>

      <div v-else class="space-y-2">
        <div v-for="exec in liveExecutions" :key="exec.id" class="queue-item !items-start">
          <div class="min-w-0 flex-1">
            <button type="button" class="flex w-full flex-wrap items-baseline justify-between gap-2 text-left" @click="toggleExec(exec.id)">
              <span class="font-display font-semibold">{{ exec.workflowName }}</span>
              <span class="flex flex-wrap items-center gap-2">
                <span class="typewriter text-[0.6rem]" style="color: var(--ink-faint)">{{ exec.trigger }}</span>
                <span class="typewriter text-[0.6rem]" style="color: var(--ink-faint)">{{ formatDuration(exec.startedAt, exec.finishedAt) }}</span>
                <span class="stamp" :class="statusClass(exec.status)">{{ exec.status }}</span>
                <span class="meta">{{ expandedExec === exec.id ? '−' : '+' }}</span>
              </span>
            </button>
            <div v-if="exec.error" class="typewriter text-[0.6rem] mt-1" style="color: var(--oxblood)">{{ exec.error }}</div>

            <div v-if="expandedExec === exec.id" class="mt-3 space-y-1">
              <div
                v-for="step in exec.steps"
                :key="step.id"
                class="flex flex-wrap items-center justify-between gap-2 border-t pt-1"
                style="border-color: var(--rule)"
              >
                <span class="typewriter text-[0.62rem]">{{ step.name || step.type }}</span>
                <span class="flex items-center gap-2">
                  <span class="typewriter text-[0.58rem]" style="color: var(--ink-faint)">{{ formatDuration(step.startedAt, step.finishedAt) }}</span>
                  <span class="stamp" :class="step.status === 'ok' ? 'stamp-green' : 'stamp-red'">{{ step.status }}</span>
                </span>
                <span v-if="step.error" class="w-full typewriter text-[0.6rem]" style="color: var(--oxblood)">{{ step.error }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

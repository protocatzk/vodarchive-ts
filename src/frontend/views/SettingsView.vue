<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppHeader from '../components/AppHeader.vue';
import { useAuthStore } from '../stores/auth';
import { useDashboardStore } from '../stores/dashboard';
import { useSettingsStore } from '../stores/settings';
import { useToast } from '../composables/useToast';
import { errorMessage } from '../lib/api';

const auth = useAuthStore();
const dashboard = useDashboardStore();
const store = useSettingsStore();
const router = useRouter();
const { show } = useToast();

const MB = 1024 * 1024;
const ready = ref(false);
const secretSet = reactive({ apiHash: false, botToken: false, n8nApiKey: false });

const form = reactive({
  apiId: 0,
  apiHash: '',
  botToken: '',
  chatId: '',
  forumChatId: '',
  forwardDropAuthor: true,
  allowedUsers: '',
  simulate: false,
  parallelWorkers: 3,
  keepFiles: false,
  doneTtlDays: 14,
  staleDays: 3,
  failedTtlDays: 30,
  splitThresholdMb: 1800,
  targetPartSizeMb: 1400,
  rssEnabled: true,
  pollIntervalSeconds: 900,
  initialBackfill: false,
  maxItemAgeHours: 48,
  maxItemsPerPoll: 10,
  allowLive: false,
  topicPerFeed: true,
  archiveChatId: '',
  archiveForumChatId: '',
  maxRetries: 0,
  n8nTimeoutSeconds: 20,
  n8nCooldownSeconds: 60,
  n8nApiBaseUrl: '',
  n8nApiKey: '',
});

function fill(): void {
  const s = store.settings;
  if (!s) return;
  form.apiId = s.telegram.apiId;
  form.apiHash = '';
  form.botToken = '';
  form.chatId = s.telegram.chatId;
  form.forumChatId = s.telegram.forumChatId;
  form.forwardDropAuthor = s.telegram.forwardDropAuthor;
  form.allowedUsers = s.telegram.allowedDashboardUsers.join(', ');
  form.simulate = s.jobs.simulate;
  form.parallelWorkers = s.jobs.parallelWorkers;
  form.keepFiles = s.jobs.keepFiles;
  form.doneTtlDays = s.jobs.doneTtlDays;
  form.staleDays = s.jobs.staleDays;
  form.failedTtlDays = s.jobs.failedTtlDays;
  form.splitThresholdMb = Math.round(s.upload.splitThresholdBytes / MB);
  form.targetPartSizeMb = Math.round(s.upload.targetPartSizeBytes / MB);
  form.rssEnabled = s.rss.enabled;
  form.pollIntervalSeconds = s.rss.pollIntervalSeconds;
  form.initialBackfill = s.rss.initialBackfill;
  form.maxItemAgeHours = s.rss.maxItemAgeHours;
  form.maxItemsPerPoll = s.rss.maxItemsPerPoll;
  form.allowLive = s.rss.allowLive;
  form.topicPerFeed = s.rss.topicPerFeed;
  form.archiveChatId = s.rss.archiveChatId;
  form.archiveForumChatId = s.rss.archiveForumChatId;
  form.maxRetries = s.rss.maxRetries;
  form.n8nTimeoutSeconds = s.n8n.timeoutSeconds;
  form.n8nCooldownSeconds = s.n8n.triggerCooldownSeconds;
  form.n8nApiBaseUrl = s.n8n.apiBaseUrl;
  form.n8nApiKey = '';
  secretSet.apiHash = s.secrets.telegramApiHash;
  secretSet.botToken = s.secrets.telegramBotToken;
  secretSet.n8nApiKey = s.secrets.n8nApiKey;
  ready.value = true;
}

onMounted(async () => {
  const authed = await auth.fetchSession();
  if (!authed) {
    router.push('/login');
    return;
  }
  try {
    await store.load();
    fill();
  } catch (error) {
    show(errorMessage(error), 'error');
  }
});

async function save(): Promise<void> {
  const patch: Record<string, unknown> = {
    telegram: {
      apiId: form.apiId,
      chatId: form.chatId,
      forumChatId: form.forumChatId,
      forwardDropAuthor: form.forwardDropAuthor,
      allowedDashboardUsers: form.allowedUsers,
      ...(form.apiHash ? { apiHash: form.apiHash } : {}),
      ...(form.botToken ? { botToken: form.botToken } : {}),
    },
    jobs: {
      simulate: form.simulate,
      parallelWorkers: form.parallelWorkers,
      keepFiles: form.keepFiles,
      doneTtlDays: form.doneTtlDays,
      staleDays: form.staleDays,
      failedTtlDays: form.failedTtlDays,
    },
    upload: {
      splitThresholdBytes: Math.round(form.splitThresholdMb * MB),
      targetPartSizeBytes: Math.round(form.targetPartSizeMb * MB),
    },
    rss: {
      enabled: form.rssEnabled,
      pollIntervalSeconds: form.pollIntervalSeconds,
      initialBackfill: form.initialBackfill,
      maxItemAgeHours: form.maxItemAgeHours,
      maxItemsPerPoll: form.maxItemsPerPoll,
      allowLive: form.allowLive,
      topicPerFeed: form.topicPerFeed,
      archiveChatId: form.archiveChatId,
      archiveForumChatId: form.archiveForumChatId,
      maxRetries: form.maxRetries,
    },
    n8n: {
      timeoutSeconds: form.n8nTimeoutSeconds,
      triggerCooldownSeconds: form.n8nCooldownSeconds,
      apiBaseUrl: form.n8nApiBaseUrl,
      ...(form.n8nApiKey ? { apiKey: form.n8nApiKey } : {}),
    },
  };

  try {
    await store.save(patch);
    fill();
    show('Einstellungen gespeichert.', 'success');
    if (store.restartRequired) {
      show('Telegram-Zugangsdaten geändert – Container/Server neu starten.', 'info');
    }
  } catch (error) {
    show(errorMessage(error), 'error');
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-6">
    <AppHeader :user="auth.user || 'Admin'" :connected="dashboard.connected" />

    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold">Einstellungen</h1>
        <p class="mt-1 text-sm text-muted">
          Persistiert in <code class="text-slate-400">data/settings.json</code>. Änderungen gelten
          sofort, außer Telegram-Zugangsdaten (Neustart nötig).
        </p>
      </div>
      <button type="button" class="btn btn-primary" :disabled="store.saving || !ready" @click="save">
        {{ store.saving ? 'Speichere…' : 'Speichern' }}
      </button>
    </div>

    <div v-if="store.restartRequired" class="card mb-6 border-amber/40 bg-amber/10 text-amber">
      Telegram-Zugangsdaten wurden geändert. Bitte Server/Container neu starten.
    </div>

    <div v-if="!ready" class="card py-10 text-center text-muted">Lade Einstellungen…</div>

    <div v-else class="space-y-6">
      <div class="card">
        <div class="mb-4 card-title">Telegram</div>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label class="block">
            <span class="stat-label mb-1 block">API ID</span>
            <input v-model.number="form.apiId" type="number" class="input" />
          </label>
          <label class="block">
            <span class="stat-label mb-1 block">API Hash</span>
            <input
              v-model="form.apiHash"
              type="password"
              class="input"
              :placeholder="secretSet.apiHash ? '•••••• (gesetzt, leer = beibehalten)' : 'noch nicht gesetzt'"
            />
          </label>
          <label class="block">
            <span class="stat-label mb-1 block">Bot Token</span>
            <input
              v-model="form.botToken"
              type="password"
              class="input"
              :placeholder="secretSet.botToken ? '•••••• (gesetzt, leer = beibehalten)' : 'noch nicht gesetzt'"
            />
          </label>
          <label class="block">
            <span class="stat-label mb-1 block">Chat ID</span>
            <input v-model="form.chatId" class="input" />
          </label>
          <label class="block">
            <span class="stat-label mb-1 block">Forum Chat ID</span>
            <input v-model="form.forumChatId" class="input" />
          </label>
          <label class="block md:col-span-2">
            <span class="stat-label mb-1 block">Erlaubte Dashboard-Nutzer (kommagetrennt)</span>
            <input v-model="form.allowedUsers" class="input" placeholder="@user1,@user2,123456" />
          </label>
          <label class="flex items-center gap-2 text-sm text-slate-300">
            <input v-model="form.forwardDropAuthor" type="checkbox" class="h-4 w-4 accent-indigo-500" />
            Autor beim Weiterleiten entfernen
          </label>
        </div>
      </div>

      <div class="card">
        <div class="mb-4 card-title">Jobs & Upload</div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label class="flex items-center gap-2 text-sm text-slate-300">
            <input v-model="form.simulate" type="checkbox" class="h-4 w-4 accent-indigo-500" />
            Uploads simulieren
          </label>
          <label class="flex items-center gap-2 text-sm text-slate-300">
            <input v-model="form.keepFiles" type="checkbox" class="h-4 w-4 accent-indigo-500" />
            Temp-Dateien behalten
          </label>
          <label class="block">
            <span class="stat-label mb-1 block">Parallele Upload-Worker</span>
            <input v-model.number="form.parallelWorkers" type="number" min="1" max="16" class="input" />
          </label>
          <label class="block">
            <span class="stat-label mb-1 block">Split-Schwelle (MB)</span>
            <input v-model.number="form.splitThresholdMb" type="number" class="input" />
          </label>
          <label class="block">
            <span class="stat-label mb-1 block">Ziel-Teilgröße (MB)</span>
            <input v-model.number="form.targetPartSizeMb" type="number" class="input" />
          </label>
          <div class="grid grid-cols-3 gap-2 lg:col-span-3">
            <label class="block">
              <span class="stat-label mb-1 block">Done TTL (Tage)</span>
              <input v-model.number="form.doneTtlDays" type="number" class="input" />
            </label>
            <label class="block">
              <span class="stat-label mb-1 block">Stale (Tage)</span>
              <input v-model.number="form.staleDays" type="number" class="input" />
            </label>
            <label class="block">
              <span class="stat-label mb-1 block">Failed TTL (Tage)</span>
              <input v-model.number="form.failedTtlDays" type="number" class="input" />
            </label>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="mb-4 card-title">RSS-Archiv</div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label class="flex items-center gap-2 text-sm text-slate-300">
            <input v-model="form.rssEnabled" type="checkbox" class="h-4 w-4 accent-indigo-500" />
            RSS aktiv
          </label>
          <label class="flex items-center gap-2 text-sm text-slate-300">
            <input v-model="form.initialBackfill" type="checkbox" class="h-4 w-4 accent-indigo-500" />
            Initial Backfill
          </label>
          <label class="flex items-center gap-2 text-sm text-slate-300">
            <input v-model="form.topicPerFeed" type="checkbox" class="h-4 w-4 accent-indigo-500" />
            Topic pro Feed
          </label>
          <label class="block">
            <span class="stat-label mb-1 block">Poll-Intervall (s)</span>
            <input v-model.number="form.pollIntervalSeconds" type="number" min="60" class="input" />
          </label>
          <label class="block">
            <span class="stat-label mb-1 block">Max. Item-Alter (h)</span>
            <input v-model.number="form.maxItemAgeHours" type="number" class="input" />
          </label>
          <label class="block">
            <span class="stat-label mb-1 block">Max. Items pro Poll</span>
            <input v-model.number="form.maxItemsPerPoll" type="number" class="input" />
          </label>
          <label class="block">
            <span class="stat-label mb-1 block">Max. Retries (0 = aus)</span>
            <input v-model.number="form.maxRetries" type="number" class="input" />
          </label>
          <label class="block">
            <span class="stat-label mb-1 block">Archiv Chat ID (optional)</span>
            <input v-model="form.archiveChatId" class="input" />
          </label>
          <label class="block">
            <span class="stat-label mb-1 block">Archiv Forum Chat ID (optional)</span>
            <input v-model="form.archiveForumChatId" class="input" />
          </label>
        </div>
      </div>

      <div class="card">
        <div class="mb-4 card-title">n8n</div>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label class="block">
            <span class="stat-label mb-1 block">Webhook-Timeout (s)</span>
            <input v-model.number="form.n8nTimeoutSeconds" type="number" class="input" />
          </label>
          <label class="block">
            <span class="stat-label mb-1 block">Trigger-Cooldown (s)</span>
            <input v-model.number="form.n8nCooldownSeconds" type="number" class="input" />
          </label>
          <label class="block">
            <span class="stat-label mb-1 block">n8n API Base URL (optional)</span>
            <input v-model="form.n8nApiBaseUrl" class="input" placeholder="https://n8n.example.com" />
          </label>
          <label class="block">
            <span class="stat-label mb-1 block">n8n API Key (optional)</span>
            <input
              v-model="form.n8nApiKey"
              type="password"
              class="input"
              :placeholder="secretSet.n8nApiKey ? '•••••• (gesetzt, leer = beibehalten)' : 'optional'"
            />
          </label>
        </div>
        <p class="mt-3 text-xs text-muted">
          Workflows werden über ihre Webhook-URLs gestartet (auch zeitgesteuert unter
          „Workflows"). Die n8n-API-Felder sind für spätere Erweiterungen vorgesehen.
        </p>
      </div>

      <div class="flex justify-end">
        <button type="button" class="btn btn-primary" :disabled="store.saving" @click="save">
          {{ store.saving ? 'Speichere…' : 'Speichern' }}
        </button>
      </div>
    </div>
  </div>
</template>

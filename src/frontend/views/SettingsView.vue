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
  dashboard.ensureConnected();
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
  <div class="folio">
    <AppHeader :user="auth.user || 'Admin'" :connected="dashboard.connected" />

    <h1 class="page-title">Ordnung</h1>
    <div v-if="store.restartRequired" class="mb-4">
      <span class="stamp stamp-brass">Neustart erforderlich</span>
    </div>

    <div v-if="!ready" class="sheet typewriter py-12 text-center" style="color: var(--ink-soft)">
      Lade Ordnung …
    </div>

    <template v-else>
      <section class="sheet mb-6">
        <div class="sheet-tab">Fernschreiber</div>
        <div class="sheet-head">
          <div class="sheet-title">Telegram</div>
          <span class="meta">Zugang</span>
        </div>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label>
            <span class="form-label">API ID</span>
            <input v-model.number="form.apiId" type="number" class="input" />
          </label>
          <label>
            <span class="form-label">API Hash</span>
            <input v-model="form.apiHash" type="password" class="input" :placeholder="secretSet.apiHash ? '•••••• (gesetzt, leer = beibehalten)' : 'noch nicht gesetzt'" />
          </label>
          <label>
            <span class="form-label">Bot Token</span>
            <input v-model="form.botToken" type="password" class="input" :placeholder="secretSet.botToken ? '•••••• (gesetzt, leer = beibehalten)' : 'noch nicht gesetzt'" />
          </label>
          <label>
            <span class="form-label">Chat ID</span>
            <input v-model="form.chatId" class="input" />
          </label>
          <label>
            <span class="form-label">Forum Chat ID</span>
            <input v-model="form.forumChatId" class="input" />
          </label>
          <label class="md:col-span-2">
            <span class="form-label">Erlaubte Leser (kommagetrennt)</span>
            <input v-model="form.allowedUsers" class="input" placeholder="@user1,@user2,123456" />
          </label>
          <label class="form-check">
            <input v-model="form.forwardDropAuthor" type="checkbox" />
            Autor beim Weiterleiten entfernen
          </label>
        </div>
      </section>

      <section class="sheet mb-6">
        <div class="sheet-tab">Ablauf</div>
        <div class="sheet-head">
          <div class="sheet-title">Vorgänge &amp; Aufteilung</div>
          <span class="meta">Bestand</span>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label class="form-check">
            <input v-model="form.simulate" type="checkbox" />
            Uploads simulieren
          </label>
          <label class="form-check">
            <input v-model="form.keepFiles" type="checkbox" />
            Temporäre Dateien behalten
          </label>
          <label>
            <span class="form-label">Parallele Upload-Worker</span>
            <input v-model.number="form.parallelWorkers" type="number" min="1" max="16" class="input" />
          </label>
          <label>
            <span class="form-label">Split-Schwelle (MB)</span>
            <input v-model.number="form.splitThresholdMb" type="number" class="input" />
          </label>
          <label>
            <span class="form-label">Ziel-Teilgröße (MB)</span>
            <input v-model.number="form.targetPartSizeMb" type="number" class="input" />
          </label>
          <div class="grid grid-cols-3 gap-3 lg:col-span-3">
            <label>
              <span class="form-label">Done TTL (Tage)</span>
              <input v-model.number="form.doneTtlDays" type="number" class="input" />
            </label>
            <label>
              <span class="form-label">Stale (Tage)</span>
              <input v-model.number="form.staleDays" type="number" class="input" />
            </label>
            <label>
              <span class="form-label">Failed TTL (Tage)</span>
              <input v-model.number="form.failedTtlDays" type="number" class="input" />
            </label>
          </div>
        </div>
      </section>

      <section class="sheet mb-6">
        <div class="sheet-tab">Zugangsbuch</div>
        <div class="sheet-head">
          <div class="sheet-title">RSS-Archiv</div>
          <span class="meta">rss.app</span>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label class="form-check"><input v-model="form.rssEnabled" type="checkbox" /> RSS aktiv</label>
          <label class="form-check"><input v-model="form.initialBackfill" type="checkbox" /> Initial Backfill</label>
          <label class="form-check"><input v-model="form.topicPerFeed" type="checkbox" /> Topic pro Feed</label>
          <label>
            <span class="form-label">Poll-Intervall (s)</span>
            <input v-model.number="form.pollIntervalSeconds" type="number" min="60" class="input" />
          </label>
          <label>
            <span class="form-label">Max. Item-Alter (h)</span>
            <input v-model.number="form.maxItemAgeHours" type="number" class="input" />
          </label>
          <label>
            <span class="form-label">Max. Items pro Poll</span>
            <input v-model.number="form.maxItemsPerPoll" type="number" class="input" />
          </label>
          <label>
            <span class="form-label">Max. Retries (0 = aus)</span>
            <input v-model.number="form.maxRetries" type="number" class="input" />
          </label>
          <label>
            <span class="form-label">Archiv Chat ID (optional)</span>
            <input v-model="form.archiveChatId" class="input" />
          </label>
          <label>
            <span class="form-label">Archiv Forum Chat ID (optional)</span>
            <input v-model="form.archiveForumChatId" class="input" />
          </label>
        </div>
      </section>

      <section class="sheet mb-6">
        <div class="sheet-tab">n8n</div>
        <div class="sheet-head">
          <div class="sheet-title">Vorgangs-Registratur</div>
          <span class="meta">API</span>
        </div>
        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label>
            <span class="form-label">Webhook-Timeout (s)</span>
            <input v-model.number="form.n8nTimeoutSeconds" type="number" class="input" />
          </label>
          <label>
            <span class="form-label">Trigger-Sperrfrist (s)</span>
            <input v-model.number="form.n8nCooldownSeconds" type="number" class="input" />
          </label>
          <label>
            <span class="form-label">n8n API Basis-URL (optional)</span>
            <input v-model="form.n8nApiBaseUrl" class="input" placeholder="https://n8n.example.com" />
          </label>
          <label>
            <span class="form-label">n8n API-Schlüssel (optional)</span>
            <input v-model="form.n8nApiKey" type="password" class="input" :placeholder="secretSet.n8nApiKey ? '•••••• (gesetzt, leer = beibehalten)' : 'optional'" />
          </label>
        </div>
      </section>

      <div class="flex justify-end">
        <button type="button" class="btn btn-primary" :disabled="store.saving" @click="save">
          {{ store.saving ? 'Speichern …' : 'Ordnung sichern' }}
        </button>
      </div>
    </template>
  </div>
</template>

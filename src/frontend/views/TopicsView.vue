<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppHeader from '../components/AppHeader.vue';
import { useAuthStore } from '../stores/auth';
import { useDashboardStore } from '../stores/dashboard';
import { useTopicsStore } from '../stores/topics';
import { useToast } from '../composables/useToast';
import { errorMessage } from '../lib/api';

const auth = useAuthStore();
const dashboard = useDashboardStore();
const topics = useTopicsStore();
const router = useRouter();
const { show } = useToast();

const newName = ref('');
const newTopicId = ref('');
const createInTelegram = ref(false);
const adding = ref(false);

const editingId = ref<number | null>(null);
const editTopicId = ref('');
const aliasName = ref('');
const savingEdit = ref(false);

const editingTopic = computed(() =>
  (topics.data?.topics ?? []).find((topic) => topic.topic_id === editingId.value) ?? null,
);

const summary = computed(() => {
  const total = topics.data?.topics.length ?? 0;
  const matches = topics.filteredTopics.length;
  return `${total} Topics · ${topics.totalAliases} Aliase${matches !== total ? ` · ${matches} Treffer` : ''}`;
});

onMounted(async () => {
  const authed = await auth.fetchSession();
  if (!authed) {
    router.push('/login');
    return;
  }
  try {
    await topics.load();
  } catch (error) {
    show(errorMessage(error, 'Topics konnten nicht geladen werden'), 'error');
  }
});

async function onChatChange(event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value;
  try {
    await topics.load(value);
  } catch (error) {
    show(errorMessage(error), 'error');
  }
}

async function addTopic(): Promise<void> {
  const name = newName.value.trim();
  if (!name) {
    show('Bitte einen Namen eingeben.', 'error');
    return;
  }
  if (!createInTelegram.value && !newTopicId.value.trim()) {
    show('Bitte eine Topic-ID angeben oder „Im Telegram-Forum erstellen“ aktivieren.', 'error');
    return;
  }
  adding.value = true;
  try {
    await topics.addTopic(name, createInTelegram.value, newTopicId.value.trim());
    show(`Topic '${name}' hinzugefügt.`, 'success');
    newName.value = '';
    newTopicId.value = '';
    createInTelegram.value = false;
  } catch (error) {
    show(errorMessage(error), 'error');
  } finally {
    adding.value = false;
  }
}

function openEdit(topicId: number): void {
  const topic = (topics.data?.topics ?? []).find((entry) => entry.topic_id === topicId);
  if (!topic) return;
  editingId.value = topicId;
  editTopicId.value = String(topic.topic_id);
  aliasName.value = '';
}

function closeEdit(): void {
  editingId.value = null;
  editTopicId.value = '';
  aliasName.value = '';
}

async function saveEdit(): Promise<void> {
  if (editingId.value === null) return;
  const parsed = Number.parseInt(editTopicId.value.trim(), 10);
  if (!/^\d+$/.test(editTopicId.value.trim()) || parsed <= 0) {
    show('Topic-ID muss eine positive Ganzzahl sein.', 'error');
    return;
  }
  savingEdit.value = true;
  try {
    const changed = await topics.remapTopic(editingId.value, parsed);
    show(`Topic-ID aktualisiert (${changed} Alias(e)).`, 'success');
    closeEdit();
  } catch (error) {
    show(errorMessage(error), 'error');
  } finally {
    savingEdit.value = false;
  }
}

async function addAlias(): Promise<void> {
  if (!editingTopic.value) return;
  const name = aliasName.value.trim();
  if (!name) {
    show('Bitte einen Alias eingeben.', 'error');
    return;
  }
  try {
    await topics.addAlias(name, editingTopic.value.topic_id);
    show(`Alias '${name}' hinzugefügt.`, 'success');
    aliasName.value = '';
  } catch (error) {
    show(errorMessage(error), 'error');
  }
}

async function removeAlias(alias: string): Promise<void> {
  if (!editingTopic.value) return;
  if (!window.confirm(`Alias '${alias}' entfernen?`)) return;
  try {
    await topics.removeAlias(alias);
    show(`Alias '${alias}' entfernt.`, 'success');
  } catch (error) {
    show(errorMessage(error), 'error');
  }
}

async function deleteTopic(topicId: number): Promise<void> {
  const topic = (topics.data?.topics ?? []).find((entry) => entry.topic_id === topicId);
  if (!topic) return;
  const message =
    `Topic '${topic.name}' (#${topicId}) mit ${topic.aliases.length} Alias(en) löschen?\n\n` +
    'Beim nächsten Upload wird gegebenenfalls ein neues Telegram-Topic erstellt.';
  if (!window.confirm(message)) return;
  try {
    await topics.deleteTopic(topicId);
    show(`Topic '${topic.name}' gelöscht.`, 'success');
    closeEdit();
  } catch (error) {
    show(errorMessage(error), 'error');
  }
}
</script>

<template>
  <div class="page">
    <AppHeader :user="auth.user || 'Admin'" :connected="dashboard.connected" />
    <h1 class="page-title mb-0">Topics verwalten</h1>
    <p class="page-subtitle text-xs">Ordne Streamer-Aliase den Telegram-Foren-Topics zu.</p>

      <div class="flex flex-wrap items-center gap-3">
        <select
          v-if="(topics.data?.chats.length ?? 0) > 1"
          class="input w-auto"
          :value="topics.data?.chat_id"
          @change="onChatChange"
        >
          <option v-for="chat in topics.data?.chats ?? []" :key="chat" :value="chat">
            {{ chat }}{{ chat === topics.data?.forum_chat_id ? ' (Forum)' : '' }}
          </option>
        </select>
        <input v-model="topics.search" class="input w-56" placeholder="Suchen…" />
        <span class="text-sm text-muted">{{ summary }}</span>
      </div>

    <!-- Neues Topic -->
    <div class="card mb-6">
      <div class="mb-3 card-title">Topic hinzufügen</div>
      <form class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end" @submit.prevent="addTopic">
        <div>
          <label class="stat-label mb-1 block">Name / Alias</label>
          <input v-model="newName" class="input" placeholder="z. B. MontanaBlack" />
        </div>
        <div>
          <label class="stat-label mb-1 block">Topic-ID</label>
          <input
            v-model="newTopicId"
            class="input"
            :disabled="createInTelegram"
            placeholder="z. B. 12345"
          />
        </div>
        <label class="flex items-center gap-2 text-sm text-slate-300">
          <input v-model="createInTelegram" type="checkbox" class="h-4 w-4 accent-indigo-500" />
          Im Telegram-Forum erstellen
        </label>
        <button type="submit" class="btn btn-primary" :disabled="adding">
          {{ adding ? 'Speichere…' : 'Hinzufügen' }}
        </button>
      </form>
    </div>

    <!-- Tabelle -->
    <div class="card">
      <div class="overflow-x-auto">
        <table v-if="topics.filteredTopics.length > 0" class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-card-border text-xs uppercase tracking-wide text-muted">
              <th class="py-2 pr-4 font-medium">Name</th>
              <th class="py-2 pr-4 font-medium">Topic</th>
              <th class="py-2 pr-4 font-medium">Aliase</th>
              <th class="py-2 font-medium">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="topic in topics.filteredTopics"
              :key="topic.topic_id"
              class="border-b border-card-border/50 last:border-0"
            >
              <td class="py-3 pr-4 font-semibold text-slate-100">{{ topic.name }}</td>
              <td class="py-3 pr-4">
                <span class="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-cyan">
                  #{{ topic.topic_id }}
                </span>
              </td>
              <td class="py-3 pr-4">
                <div class="flex flex-wrap gap-1">
                  <span
                    v-for="alias in topic.aliases.slice(0, 4)"
                    :key="alias"
                    class="rounded-full border border-card-border bg-white/5 px-2 py-0.5 text-xs"
                  >
                    {{ alias }}
                  </span>
                  <span
                    v-if="topic.aliases.length > 4"
                    class="rounded-full border border-card-border bg-white/5 px-2 py-0.5 text-xs text-muted"
                  >
                    +{{ topic.aliases.length - 4 }}
                  </span>
                </div>
              </td>
              <td class="py-3">
                <div class="flex flex-wrap gap-2">
                  <a class="btn text-xs" :href="topic.link" target="_blank" rel="noopener">Öffnen</a>
                  <button type="button" class="btn text-xs" @click="openEdit(topic.topic_id)">
                    Bearbeiten
                  </button>
                  <button type="button" class="btn btn-danger text-xs" @click="deleteTopic(topic.topic_id)">
                    Löschen
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-else class="py-12 text-center text-sm text-muted">
          {{ topics.data?.topics.length ? 'Kein Topic passt zur Suche.' : 'Füge oben ein Topic hinzu.' }}
        </div>
      </div>
    </div>

    <!-- Edit-Modal -->
    <div
      v-if="editingTopic"
      class="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
      @click.self="closeEdit"
    >
      <div class="card max-h-[90vh] w-full max-w-lg overflow-y-auto">
        <div class="mb-1 flex items-center justify-between">
          <h2 class="text-lg font-bold">{{ editingTopic.name }}</h2>
          <button type="button" class="btn !px-2 !py-0.5 text-xs" @click="closeEdit">✕</button>
        </div>
        <div class="mb-4 text-xs text-muted">
          {{ editingTopic.aliases.length }} Alias(e) · Topic #{{ editingTopic.topic_id }}
        </div>

        <div class="mb-4">
          <label class="stat-label mb-1 block">Topic-ID ändern</label>
          <div class="flex gap-2">
            <input v-model="editTopicId" class="input" placeholder="Neue Topic-ID" />
            <button type="button" class="btn btn-primary" :disabled="savingEdit" @click="saveEdit">
              {{ savingEdit ? 'Speichere…' : 'Speichern' }}
            </button>
          </div>
        </div>

        <div class="mb-4">
          <label class="stat-label mb-1 block">Aliase</label>
          <div class="flex flex-wrap gap-1">
            <span
              v-for="alias in editingTopic.aliases"
              :key="alias"
              class="inline-flex items-center gap-1 rounded-full border border-card-border bg-white/5 px-2 py-0.5 text-xs"
            >
              {{ alias }}
              <button
                type="button"
                class="text-rose hover:text-rose/70"
                title="Alias entfernen"
                @click="removeAlias(alias)"
              >
                ×
              </button>
            </span>
            <span v-if="editingTopic.aliases.length === 0" class="text-xs text-muted">Keine Aliase.</span>
          </div>
        </div>

        <form class="flex gap-2" @submit.prevent="addAlias">
          <input v-model="aliasName" class="input" placeholder="Neuer Alias" />
          <button type="submit" class="btn">Hinzufügen</button>
        </form>
      </div>
    </div>
  </div>
</template>

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
  dashboard.ensureConnected();
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
    show('Bitte eine Topic-ID angeben oder „Im Telegram-Forum erstellen" aktivieren.', 'error');
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
  <div class="folio">
    <AppHeader :user="auth.user || 'Admin'" :connected="dashboard.connected" />

    <h1 class="page-title">Register der Themen</h1>

    <div class="mb-6 flex flex-wrap items-center gap-3">
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
      <input v-model="topics.search" class="input w-56" placeholder="Im Register suchen …" />
      <span class="meta">{{ summary }}</span>
    </div>

    <section class="sheet mb-6">
      <div class="sheet-tab">Neuer Eintrag</div>
      <div class="sheet-head">
        <div class="sheet-title">Topic hinzufügen</div>
        <span class="meta">Register · {{ topics.data?.chat_id || '—' }}</span>
      </div>
      <form
        class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4 lg:items-end"
        @submit.prevent="addTopic"
      >
        <label>
          <span class="form-label">Name / Alias</span>
          <input v-model="newName" class="input" placeholder="z. B. MontanaBlack" />
        </label>
        <label>
          <span class="form-label">Topic-ID</span>
          <input v-model="newTopicId" class="input" :disabled="createInTelegram" placeholder="z. B. 12345" />
        </label>
        <label class="form-check">
          <input v-model="createInTelegram" type="checkbox" />
          Im Telegram-Forum anlegen
        </label>
        <button type="submit" class="btn btn-primary" :disabled="adding">
          {{ adding ? 'Wird eingetragen …' : 'Eintragen' }}
        </button>
      </form>
    </section>

    <section class="sheet">
      <div class="sheet-tab">Bestand</div>
      <div class="sheet-head">
        <div class="sheet-title">Zuordnungen</div>
        <span class="meta">{{ topics.data?.topics.length ?? 0 }} Einträge</span>
      </div>

      <div v-if="topics.filteredTopics.length > 0" class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th class="min-w-[12rem]">Name</th>
              <th class="min-w-[6rem]">Topic</th>
              <th class="min-w-[18rem]">Aliase</th>
              <th class="min-w-[16rem]">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="topic in topics.filteredTopics" :key="topic.topic_id">
              <td class="font-display font-semibold">{{ topic.name }}</td>
              <td>
                <span class="typewriter text-xs" style="color: var(--oxblood)">#{{ topic.topic_id }}</span>
              </td>
              <td>
                <div class="flex flex-wrap gap-1">
                  <span v-for="alias in topic.aliases.slice(0, 4)" :key="alias" class="chip">{{ alias }}</span>
                  <span v-if="topic.aliases.length > 4" class="chip chip-more">+{{ topic.aliases.length - 4 }}</span>
                </div>
              </td>
              <td>
                <div class="flex flex-wrap gap-2">
                  <a class="btn" :href="topic.link" target="_blank" rel="noopener">Öffnen</a>
                  <button type="button" class="btn" @click="openEdit(topic.topic_id)">Bearbeiten</button>
                  <button type="button" class="btn btn-danger" @click="deleteTopic(topic.topic_id)">Löschen</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else class="py-12 text-center italic" style="color: var(--ink-faint)">
        {{ topics.data?.topics.length ? 'Keine Treffer.' : 'Keine Einträge.' }}
      </div>
    </section>

    <!-- Bearbeitungsbogen -->
    <div
      v-if="editingTopic"
      class="fixed inset-0 z-40 flex items-center justify-center p-4"
      style="background: rgba(42, 35, 24, 0.55)"
      @click.self="closeEdit"
    >
      <div class="sheet w-full max-w-lg" style="max-height: 90vh; overflow-y: auto">
        <div class="sheet-head">
          <div class="sheet-title">{{ editingTopic.name }}</div>
          <button type="button" class="btn btn-ghost" @click="closeEdit">✕</button>
        </div>
        <div class="meta mb-4">{{ editingTopic.aliases.length }} Alias(e) · Topic #{{ editingTopic.topic_id }}</div>

        <div class="mb-5">
          <span class="form-label">Topic-ID ändern</span>
          <div class="flex gap-2">
            <input v-model="editTopicId" class="input" placeholder="Neue Topic-ID" />
            <button type="button" class="btn btn-primary" :disabled="savingEdit" @click="saveEdit">
              {{ savingEdit ? 'Speichern …' : 'Speichern' }}
            </button>
          </div>
        </div>

        <div class="mb-5">
          <span class="form-label">Aliase</span>
          <div class="flex flex-wrap gap-1">
            <span v-for="alias in editingTopic.aliases" :key="alias" class="chip">
              {{ alias }}
              <button type="button" class="ml-1" style="color: var(--oxblood)" title="Alias entfernen" @click="removeAlias(alias)">
                ×
              </button>
            </span>
            <span v-if="editingTopic.aliases.length === 0" class="meta">Keine Aliase.</span>
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

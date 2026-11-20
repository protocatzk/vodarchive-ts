import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api, endpoints, errorMessage } from '../lib/api';
import type { TopicsPayload } from '../types';

export const useTopicsStore = defineStore('topics', () => {
  const data = ref<TopicsPayload | null>(null);
  const search = ref('');
  const loading = ref(false);
  const error = ref('');

  const totalAliases = computed(() =>
    (data.value?.topics ?? []).reduce((sum, topic) => sum + topic.aliases.length, 0),
  );

  const filteredTopics = computed(() => {
    const topics = data.value?.topics ?? [];
    const query = search.value.trim().toLowerCase();
    if (!query) return topics;
    return topics.filter((topic) => {
      if (String(topic.topic_id).includes(query)) return true;
      if (topic.name.toLowerCase().includes(query)) return true;
      return topic.aliases.some((alias) => alias.toLowerCase().includes(query));
    });
  });

  async function load(chatId?: string): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
      const url = chatId
        ? `${endpoints.topics()}?chat_id=${encodeURIComponent(chatId)}`
        : endpoints.topics();
      const { data: payload } = await api.get<TopicsPayload>(url);
      data.value = payload;
    } catch (err) {
      error.value = errorMessage(err, 'Topics konnten nicht geladen werden');
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function addTopic(name: string, create: boolean, topicId?: string): Promise<void> {
    await api.post(endpoints.topics(), {
      chat_id: data.value?.chat_id,
      name,
      create,
      ...(create ? {} : { topic_id: topicId }),
    });
    await load(data.value?.chat_id);
  }

  async function remapTopic(oldId: number, newId: number): Promise<number> {
    const { data: result } = await api.patch<{ changed: number }>(endpoints.topics(), {
      chat_id: data.value?.chat_id,
      topic_id: oldId,
      new_topic_id: newId,
    });
    await load(data.value?.chat_id);
    return result.changed;
  }

  async function deleteTopic(topicId: number): Promise<void> {
    await api.delete(endpoints.topics(), {
      params: { chat_id: data.value?.chat_id, topic_id: topicId },
    });
    await load(data.value?.chat_id);
  }

  async function addAlias(name: string, topicId: number): Promise<void> {
    await api.post(endpoints.topicAlias(), {
      chat_id: data.value?.chat_id,
      name,
      topic_id: topicId,
    });
    await load(data.value?.chat_id);
  }

  async function removeAlias(name: string): Promise<void> {
    await api.delete(endpoints.topicAlias(), {
      params: { chat_id: data.value?.chat_id, name },
    });
    await load(data.value?.chat_id);
  }

  return {
    data,
    search,
    loading,
    error,
    totalAliases,
    filteredTopics,
    load,
    addTopic,
    remapTopic,
    deleteTopic,
    addAlias,
    removeAlias,
  };
});

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api, endpoints, errorMessage } from '../lib/api';
import type { Source, SourceType } from '../types';

export interface SourceTestResult {
  ok: boolean;
  feeds: number;
  items: number;
  error?: string;
}

export const useSourcesStore = defineStore('sources', () => {
  const sources = ref<Source[]>([]);
  const loading = ref(false);
  const error = ref('');

  async function load(): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
      const { data } = await api.get<{ sources: Source[] }>(endpoints.sources());
      sources.value = data.sources;
    } catch (err) {
      error.value = errorMessage(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function add(input: {
    name: string;
    type: SourceType;
    url: string;
    pollIntervalSeconds?: number | null;
    cookie?: string;
    apiBaseUrl?: string;
    listPath?: string;
    limit?: number;
    itemsPath?: string;
    targets?: string[];
    initialBackfill?: boolean;
    onlyNew?: boolean;
    dryRun?: boolean;
    testMode?: boolean;
    testChatId?: string;
    testForumChatId?: string;
  }): Promise<void> {
    await api.post(endpoints.sources(), input);
    await load();
  }

  async function update(id: string, patch: Record<string, unknown>): Promise<void> {
    await api.patch(endpoints.source(id), patch);
    await load();
  }

  async function remove(id: string): Promise<void> {
    await api.delete(endpoints.source(id));
    await load();
  }

  async function check(id: string): Promise<string> {
    try {
      const { data } = await api.post<{ status: string }>(endpoints.sourceCheck(id));
      return data.status;
    } catch (err) {
      return errorMessage(err, 'Fehler');
    }
  }

  async function preview(id: string): Promise<{
    ok: boolean;
    total?: number;
    targets?: number;
    items?: Array<{
      id: string;
      recordingId: string;
      title: string;
      streamer: string;
      platform: string;
      published: number | null;
      filesizeMb: number;
      thumbnail: string | null;
      url: string;
    }>;
    error?: string;
  }> {
    try {
      const { data } = await api.post(endpoints.sourcePreview(id));
      return data;
    } catch (err) {
      return { ok: false, error: errorMessage(err, 'Vorschau fehlgeschlagen') };
    }
  }

  async function ensureTopics(id: string): Promise<{
    ok: boolean;
    chatId?: string;
    created?: number;
    existing?: number;
    failed?: number;
    streamers?: Array<{ name: string; topicId?: number; existing?: boolean; error?: string }>;
    error?: string;
  }> {
    try {
      const { data } = await api.post(endpoints.sourceEnsureTopics(id));
      return data;
    } catch (err) {
      return { ok: false, error: errorMessage(err, 'Themen konnten nicht angelegt werden') };
    }
  }

  async function test(
    type: SourceType,
    url: string,
    extra: Record<string, unknown> = {},
  ): Promise<SourceTestResult & { total?: number; targets?: number; sample?: Record<string, unknown> | null }> {
    try {
      const { data } = await api.post<
        SourceTestResult & { total?: number; targets?: number; sample?: Record<string, unknown> | null }
      >(endpoints.sourceTest(), { type, url, ...extra });
      return data;
    } catch (err) {
      return { ok: false, feeds: 0, items: 0, error: errorMessage(err, 'Test fehlgeschlagen') };
    }
  }

  return { sources, loading, error, load, add, update, remove, check, preview, ensureTopics, test };
});

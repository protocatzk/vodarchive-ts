import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api, endpoints, errorMessage } from '../lib/api';
import type { Snapshot } from '../types';

export const useDashboardStore = defineStore('dashboard', () => {
  const snapshot = ref<Snapshot | null>(null);
  const connected = ref(false);
  const loading = ref(false);

  let source: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function apply(data: Snapshot): void {
    snapshot.value = data;
  }

  async function fetchStatus(): Promise<boolean> {
    loading.value = true;
    try {
      const { data } = await api.get<Snapshot>(endpoints.status());
      apply(data);
      return true;
    } catch {
      return false;
    } finally {
      loading.value = false;
    }
  }

  function connect(): void {
    disposed = false;
    if (source) source.close();
    source = new EventSource(endpoints.events());

    source.onopen = () => {
      connected.value = true;
    };

    source.onmessage = (event) => {
      try {
        apply(JSON.parse(event.data) as Snapshot);
        connected.value = true;
      } catch {
        /* ignore malformed frames */
      }
    };

    source.onerror = () => {
      connected.value = false;
      source?.close();
      source = null;
      if (disposed) return;
      retryTimer = setTimeout(connect, 3000);
    };
  }

  function disconnect(): void {
    disposed = true;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    source?.close();
    source = null;
    connected.value = false;
  }

  async function cancelJob(key: string): Promise<string> {
    try {
      const { data } = await api.post<{ status: string }>(endpoints.cancelJob(), { key });
      return data.status;
    } catch (err) {
      throw new Error(errorMessage(err, 'Abbruch fehlgeschlagen'));
    }
  }

  async function clearHistory(): Promise<number> {
    try {
      const { data } = await api.delete<{ removed: number }>(endpoints.history());
      await fetchStatus();
      return data.removed;
    } catch (err) {
      throw new Error(errorMessage(err, 'Verlauf konnte nicht geleert werden'));
    }
  }

  async function triggerRss(): Promise<string> {
    try {
      const { data } = await api.post<{ status: string }>(endpoints.rssCheck());
      return data.status;
    } catch (err) {
      return errorMessage(err, 'Fehler');
    }
  }

  async function backfillRss(): Promise<string> {
    try {
      const { data } = await api.post<{ status: string }>(endpoints.rssBackfill(10));
      return data.status;
    } catch (err) {
      return errorMessage(err, 'Fehler');
    }
  }

  async function resetRss(): Promise<{ reset?: number }> {
    try {
      const { data } = await api.post<{ status: string; reset: number }>(endpoints.rssRetry());
      return data;
    } catch (err) {
      throw new Error(errorMessage(err, 'Fehler'));
    }
  }

  async function triggerN8n(name: string): Promise<string> {
    try {
      const { data } = await api.post<{ status: string }>(endpoints.n8nRun(name));
      return data.status;
    } catch (err) {
      return errorMessage(err, 'Fehler');
    }
  }

  return {
    snapshot,
    connected,
    loading,
    fetchStatus,
    connect,
    disconnect,
    cancelJob,
    clearHistory,
    triggerRss,
    backfillRss,
    resetRss,
    triggerN8n,
  };
});

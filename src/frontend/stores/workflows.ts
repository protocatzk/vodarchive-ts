import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api, endpoints, errorMessage } from '../lib/api';
import type { N8nDiscoveredWorkflow, Workflow } from '../types';

export const useWorkflowsStore = defineStore('workflows', () => {
  const workflows = ref<Workflow[]>([]);
  const loading = ref(false);
  const error = ref('');

  const discovered = ref<N8nDiscoveredWorkflow[]>([]);
  const discovering = ref(false);
  const discoverError = ref('');
  const n8nConfigured = ref<boolean | null>(null);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
      const { data } = await api.get<{ workflows: Workflow[] }>(endpoints.workflows());
      workflows.value = data.workflows;
    } catch (err) {
      error.value = errorMessage(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function add(input: {
    name: string;
    webhookUrl: string;
    intervalSeconds: number;
  }): Promise<void> {
    await api.post(endpoints.workflows(), input);
    await load();
  }

  async function update(id: string, patch: Record<string, unknown>): Promise<void> {
    await api.patch(endpoints.workflow(id), patch);
    await load();
  }

  async function remove(id: string): Promise<void> {
    await api.delete(endpoints.workflow(id));
    await load();
  }

  async function run(id: string): Promise<{ status: string; error?: string }> {
    try {
      const { data } = await api.post<{ status: string; error?: string }>(
        endpoints.workflowRun(id),
      );
      await load();
      return data;
    } catch (err) {
      await load().catch(() => undefined);
      return { status: 'failed', error: errorMessage(err, 'Ausführung fehlgeschlagen') };
    }
  }

  async function checkN8n(): Promise<void> {
    try {
      const { data } = await api.get<{ configured: boolean; ok?: boolean; error?: string }>(
        endpoints.n8nStatus(),
      );
      n8nConfigured.value = Boolean(data.configured && data.ok);
      discoverError.value = data.configured && !data.ok ? (data.error ?? 'Verbindung fehlgeschlagen') : '';
    } catch (err) {
      n8nConfigured.value = false;
      discoverError.value = errorMessage(err);
    }
  }

  async function discover(): Promise<void> {
    discovering.value = true;
    discoverError.value = '';
    try {
      const { data } = await api.get<{ workflows: N8nDiscoveredWorkflow[] }>(
        endpoints.n8nDiscover(),
      );
      discovered.value = data.workflows;
      n8nConfigured.value = true;
    } catch (err) {
      discovered.value = [];
      discoverError.value = errorMessage(err, 'n8n-API nicht erreichbar');
      n8nConfigured.value = false;
    } finally {
      discovering.value = false;
    }
  }

  async function setActive(id: string, active: boolean): Promise<void> {
    await api.post(endpoints.n8nSetActive(id, active));
    const target = discovered.value.find((workflow) => workflow.id === id);
    if (target) target.active = active;
  }

  async function importWorkflow(id: string, intervalSeconds = 0): Promise<boolean> {
    const { data } = await api.post<{ imported: boolean }>(endpoints.n8nImport(id), {
      intervalSeconds,
    });
    await load();
    return data.imported;
  }

  return {
    workflows,
    loading,
    error,
    discovered,
    discovering,
    discoverError,
    n8nConfigured,
    load,
    add,
    update,
    remove,
    run,
    checkN8n,
    discover,
    setActive,
    importWorkflow,
  };
});

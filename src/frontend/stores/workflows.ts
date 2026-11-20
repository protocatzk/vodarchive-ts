import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api, endpoints, errorMessage } from '../lib/api';
import type { Workflow } from '../types';

export const useWorkflowsStore = defineStore('workflows', () => {
  const workflows = ref<Workflow[]>([]);
  const loading = ref(false);
  const error = ref('');

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

  return { workflows, loading, error, load, add, update, remove, run };
});

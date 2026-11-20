import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api, endpoints, errorMessage } from '../lib/api';
import type { MaskedSettings } from '../types';

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<MaskedSettings | null>(null);
  const loading = ref(false);
  const saving = ref(false);
  const error = ref('');
  const restartRequired = ref(false);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = '';
    try {
      const { data } = await api.get<MaskedSettings>(endpoints.settings());
      settings.value = data;
      restartRequired.value = false;
    } catch (err) {
      error.value = errorMessage(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function save(patch: unknown): Promise<MaskedSettings> {
    saving.value = true;
    error.value = '';
    try {
      const { data } = await api.put<{
        status: string;
        restartRequired: boolean;
        settings: MaskedSettings;
      }>(endpoints.settings(), patch);
      settings.value = data.settings;
      restartRequired.value = data.restartRequired;
      return data.settings;
    } catch (err) {
      error.value = errorMessage(err);
      throw err;
    } finally {
      saving.value = false;
    }
  }

  return { settings, loading, saving, error, restartRequired, load, save };
});

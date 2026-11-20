import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api, endpoints, errorMessage } from '../lib/api';

export interface LoginRequestResult {
  token: string;
  bot_username: string;
  deep_link: string;
  status: string;
  user?: string;
  dev?: boolean;
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref('');
  const authenticated = ref(false);
  const dev = ref(false);
  const loading = ref(false);
  const error = ref('');

  async function fetchSession(): Promise<boolean> {
    try {
      const { data } = await api.get<{ authenticated: boolean; user?: string; dev?: boolean }>(
        endpoints.authSession(),
      );
      authenticated.value = Boolean(data.authenticated);
      user.value = data.user ?? '';
      dev.value = Boolean(data.dev);
      return authenticated.value;
    } catch {
      authenticated.value = false;
      return false;
    }
  }

  async function requestLogin(): Promise<LoginRequestResult> {
    loading.value = true;
    error.value = '';
    try {
      const { data } = await api.post<LoginRequestResult>(endpoints.authRequest());
      if (data.status === 'approved') {
        authenticated.value = true;
        user.value = data.user ?? '';
        dev.value = Boolean(data.dev);
      }
      return data;
    } catch (err) {
      error.value = errorMessage(err);
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function checkToken(token: string): Promise<{ status: string; user?: string }> {
    const { data } = await api.get<{ status: string; user?: string }>(endpoints.authCheck(token));
    if (data.status === 'approved') {
      authenticated.value = true;
      user.value = data.user ?? '';
    }
    return data;
  }

  async function logout(): Promise<void> {
    try {
      await api.post(endpoints.logout());
    } catch {
      /* ignore */
    }
    authenticated.value = false;
    user.value = '';
  }

  return { user, authenticated, dev, loading, error, fetchSession, requestLogin, checkToken, logout };
});

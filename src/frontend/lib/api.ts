import axios from 'axios';

export const api = axios.create({
  baseURL: '',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

const API_BASE = '/voduploader/api';
const RSS_BASE = '/voduploader/rss';
const N8N_BASE = '/voduploader/n8n';

export const endpoints = {
  authRequest: () => `${API_BASE}/auth/request`,
  authCheck: (token: string) => `${API_BASE}/auth/check?token=${encodeURIComponent(token)}`,
  authSession: () => `${API_BASE}/auth/session`,
  logout: () => `${API_BASE}/auth/logout`,
  status: () => `${API_BASE}/status`,
  events: () => `${API_BASE}/events`,
  cancelJob: () => `${API_BASE}/jobs/cancel`,
  topics: () => `${API_BASE}/topics`,
  topicAlias: () => `${API_BASE}/topics/alias`,
  rssStatus: () => `${RSS_BASE}/status`,
  rssCheck: () => `${RSS_BASE}/check`,
  rssBackfill: (limit = 10) => `${RSS_BASE}/backfill?limit=${limit}`,
  rssRetry: () => `${API_BASE}/rss/retry`,
  n8nRun: (name: string) => `${N8N_BASE}/run?name=${encodeURIComponent(name)}`,
};

export function errorMessage(error: unknown, fallback = 'Unbekannter Fehler'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string } | undefined;
    return data?.error || `HTTP ${error.response?.status ?? '?'}`;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

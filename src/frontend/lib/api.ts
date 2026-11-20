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
  history: () => `${API_BASE}/history`,
  topics: () => `${API_BASE}/topics`,
  topicAlias: () => `${API_BASE}/topics/alias`,
  settings: () => `${API_BASE}/settings`,
  sources: () => `${API_BASE}/sources`,
  sourceTest: () => `${API_BASE}/sources/test`,
  source: (id: string) => `${API_BASE}/sources/${encodeURIComponent(id)}`,
  sourceCheck: (id: string) => `${API_BASE}/sources/${encodeURIComponent(id)}/check`,
  sourcePreview: (id: string) => `${API_BASE}/sources/${encodeURIComponent(id)}/preview`,
  workflows: () => `${API_BASE}/workflows`,
  workflow: (id: string) => `${API_BASE}/workflows/${encodeURIComponent(id)}`,
  workflowRun: (id: string) => `${API_BASE}/workflows/${encodeURIComponent(id)}/run`,
  executions: (workflowId?: string) =>
    `${API_BASE}/workflows/executions${workflowId ? `?workflow_id=${encodeURIComponent(workflowId)}` : ''}`,
  n8nStatus: () => `${N8N_BASE}/status`,
  n8nDiscover: () => `${N8N_BASE}/discover`,
  n8nSetActive: (id: string, active: boolean) =>
    `${N8N_BASE}/discover/${encodeURIComponent(id)}/${active ? 'activate' : 'deactivate'}`,
  n8nImport: (id: string) => `${N8N_BASE}/import/${encodeURIComponent(id)}`,
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

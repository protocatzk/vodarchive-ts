import { settingsStore } from '../settings/store';

export interface N8nWorkflowSummary {
  id: string;
  name: string;
  active: boolean;
  webhookPath: string | null;
  webhookUrl: string | null;
  updatedAt: string | null;
  tags: string[];
}

interface N8nNode {
  type?: string;
  webhookId?: string;
  parameters?: Record<string, unknown>;
}

interface N8nWorkflowRaw {
  id?: string | number;
  name?: string;
  active?: boolean;
  updatedAt?: string;
  nodes?: N8nNode[];
  tags?: Array<{ name?: string }>;
}

function normalizeBaseUrl(input: string): { root: string; api: string } {
  let base = input.trim().replace(/\/+$/, '');
  if (base.endsWith('/api/v1')) base = base.slice(0, -'/api/v1'.length);
  return { root: base, api: `${base}/api/v1` };
}

function deriveWebhook(workflow: N8nWorkflowRaw, root: string): { path: string | null; url: string | null } {
  const node = (workflow.nodes ?? []).find((entry) =>
    String(entry.type ?? '').toLowerCase().includes('webhook'),
  );
  if (!node) return { path: null, url: null };
  const rawPath = node.parameters?.['path'];
  const path = typeof rawPath === 'string' && rawPath.trim() ? rawPath.trim() : node.webhookId;
  if (!path) return { path: null, url: null };
  return { path, url: `${root}/webhook/${path.replace(/^\/+/, '')}` };
}

export class N8nApiClient {
  private readonly root: string;
  private readonly api: string;

  constructor(baseUrl: string, private readonly apiKey: string) {
    const normalized = normalizeBaseUrl(baseUrl);
    this.root = normalized.root;
    this.api = normalized.api;
  }

  static fromSettings(): N8nApiClient | null {
    const { apiBaseUrl, apiKey } = settingsStore.get().n8n;
    if (!apiBaseUrl || !apiKey) return null;
    return new N8nApiClient(apiBaseUrl, apiKey);
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${this.api}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'X-N8N-API-KEY': this.apiKey,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init.headers ?? {}),
        },
      });
      const text = await response.text();
      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const parsed = JSON.parse(text) as { message?: string };
          if (parsed.message) message = parsed.message;
        } catch {
          if (text) message = text.slice(0, 200);
        }
        throw new Error(message);
      }
      if (!text) return null;
      return JSON.parse(text) as unknown;
    } finally {
      clearTimeout(timer);
    }
  }

  async test(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.request('/workflows?limit=1');
      return { ok: true };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  async listWorkflows(): Promise<N8nWorkflowSummary[]> {
    const result: N8nWorkflowSummary[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const query = `?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const payload = (await this.request(`/workflows${query}`)) as {
        data?: N8nWorkflowRaw[];
        nextCursor?: string | null;
      };
      const data = payload?.data ?? [];
      for (const workflow of data) {
        if (workflow.id === undefined) continue;
        const webhook = deriveWebhook(workflow, this.root);
        result.push({
          id: String(workflow.id),
          name: String(workflow.name ?? workflow.id),
          active: Boolean(workflow.active),
          webhookPath: webhook.path,
          webhookUrl: webhook.url,
          updatedAt: workflow.updatedAt ?? null,
          tags: (workflow.tags ?? []).map((tag) => String(tag.name ?? '')).filter(Boolean),
        });
      }
      if (!payload?.nextCursor) break;
      cursor = payload.nextCursor;
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  async setActive(id: string, active: boolean): Promise<void> {
    await this.request(`/workflows/${encodeURIComponent(id)}/${active ? 'activate' : 'deactivate'}`, {
      method: 'POST',
    });
  }
}

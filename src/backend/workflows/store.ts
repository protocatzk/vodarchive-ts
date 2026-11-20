import crypto from 'node:crypto';
import path from 'node:path';
import { config } from '../config';
import { logger } from '../logger';
import { readJsonFile, writeJsonFileAtomic } from '../util/json';

export type WorkflowStatus = 'ok' | 'failed' | 'timeout' | 'cooldown';

export interface Workflow {
  id: string;
  name: string;
  webhookUrl: string;
  enabled: boolean;
  intervalSeconds: number;
  createdAt: string;
  lastRun: number | null;
  lastStatus: WorkflowStatus | null;
  lastHttpStatus: number | null;
  lastError: string | null;
  runCount: number;
}

export interface WorkflowInput {
  name?: unknown;
  webhookUrl?: unknown;
  enabled?: unknown;
  intervalSeconds?: unknown;
}

function sanitizeUrl(value: unknown): string {
  const url = String(value ?? '').trim();
  if (!url) throw new Error('Webhook-URL darf nicht leer sein.');
  if (!/^https?:\/\//i.test(url)) throw new Error('Webhook-URL muss mit http(s):// beginnen.');
  if (url.length > 2048) throw new Error('Webhook-URL ist zu lang.');
  return url;
}

function sanitizeInterval(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.max(60, Math.min(7 * 86400, parsed));
}

export class WorkflowStore {
  readonly file: string;
  private data: Workflow[];

  constructor(file = path.join(config.paths.baseDir, 'workflows.json')) {
    this.file = file;
    this.data = readJsonFile<Workflow[]>(file, []);
    if (this.data.length === 0) {
      this.data = this.seed();
      if (this.data.length) this.persist();
    }
  }

  private seed(): Workflow[] {
    return Object.entries(config.n8n.webhooks).map(([name, webhookUrl]) => ({
      id: crypto.randomUUID(),
      name,
      webhookUrl,
      enabled: true,
      intervalSeconds: 0,
      createdAt: new Date().toISOString(),
      lastRun: null,
      lastStatus: null,
      lastHttpStatus: null,
      lastError: null,
      runCount: 0,
    }));
  }

  private persist(): void {
    try {
      writeJsonFileAtomic(this.file, this.data, 0o600);
    } catch (error) {
      logger.warn(`Workflows konnten nicht gespeichert werden: ${String(error)}`);
    }
  }

  list(): Workflow[] {
    return this.data.map((workflow) => ({ ...workflow }));
  }

  get(id: string): Workflow | null {
    const workflow = this.data.find((entry) => entry.id === id);
    return workflow ? { ...workflow } : null;
  }

  findByName(name: string): Workflow | null {
    const workflow = this.data.find((entry) => entry.name === name);
    return workflow ? { ...workflow } : null;
  }

  add(input: WorkflowInput): Workflow {
    const name = String(input.name ?? '').trim();
    if (!name) throw new Error('Name darf nicht leer sein.');
    const workflow: Workflow = {
      id: crypto.randomUUID(),
      name: name.slice(0, 120),
      webhookUrl: sanitizeUrl(input.webhookUrl),
      enabled: input.enabled === undefined ? true : Boolean(input.enabled),
      intervalSeconds: sanitizeInterval(input.intervalSeconds),
      createdAt: new Date().toISOString(),
      lastRun: null,
      lastStatus: null,
      lastHttpStatus: null,
      lastError: null,
      runCount: 0,
    };
    this.data.push(workflow);
    this.persist();
    return { ...workflow };
  }

  update(id: string, input: WorkflowInput): Workflow {
    const workflow = this.data.find((entry) => entry.id === id);
    if (!workflow) throw new Error('Workflow nicht gefunden.');
    if (input.name !== undefined) {
      const name = String(input.name).trim();
      if (!name) throw new Error('Name darf nicht leer sein.');
      workflow.name = name.slice(0, 120);
    }
    if (input.webhookUrl !== undefined) workflow.webhookUrl = sanitizeUrl(input.webhookUrl);
    if (input.enabled !== undefined) workflow.enabled = Boolean(input.enabled);
    if (input.intervalSeconds !== undefined) {
      workflow.intervalSeconds = sanitizeInterval(input.intervalSeconds);
    }
    this.persist();
    return { ...workflow };
  }

  remove(id: string): boolean {
    const index = this.data.findIndex((entry) => entry.id === id);
    if (index === -1) return false;
    this.data.splice(index, 1);
    this.persist();
    return true;
  }

  markRun(
    id: string,
    result: { status: WorkflowStatus; httpStatus?: number | null; error?: string | null; at: number },
  ): void {
    const workflow = this.data.find((entry) => entry.id === id);
    if (!workflow) return;
    workflow.lastRun = result.at;
    workflow.lastStatus = result.status;
    workflow.lastHttpStatus = result.httpStatus ?? null;
    workflow.lastError = result.error ?? null;
    workflow.runCount += 1;
    this.persist();
  }

  due(now: number): Workflow[] {
    return this.data
      .filter(
        (workflow) =>
          workflow.enabled &&
          workflow.intervalSeconds > 0 &&
          (workflow.lastRun === null || workflow.lastRun + workflow.intervalSeconds <= now),
      )
      .map((workflow) => ({ ...workflow }));
  }

  enabledNames(): string[] {
    return this.data.filter((workflow) => workflow.enabled).map((workflow) => workflow.name);
  }
}

export const workflowStore = new WorkflowStore();

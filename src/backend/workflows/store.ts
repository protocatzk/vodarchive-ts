import crypto from 'node:crypto';
import path from 'node:path';
import { config } from '../config';
import { logger } from '../logger';
import { readJsonFile, writeJsonFileAtomic } from '../util/json';

export type WorkflowStatus = 'ok' | 'failed' | 'timeout' | 'cooldown';
export type WorkflowKind = 'webhook' | 'internal';
export type WorkflowTriggerType = 'manual' | 'schedule';

export interface WorkflowStep {
  id?: string;
  type: string;
  name?: string;
  continueOnError?: boolean;
  [key: string]: unknown;
}

export interface WorkflowTrigger {
  type: WorkflowTriggerType;
  intervalSeconds?: number;
}

export interface WorkflowDefinition {
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
}

export interface Workflow {
  id: string;
  name: string;
  kind: WorkflowKind;
  webhookUrl: string;
  definition?: WorkflowDefinition;
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
  kind?: unknown;
  webhookUrl?: unknown;
  enabled?: unknown;
  intervalSeconds?: unknown;
  definition?: unknown;
}

function sanitizeUrl(value: unknown): string {
  const url = String(value ?? '').trim();
  if (!url) return '';
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

function sanitizeDefinition(value: unknown): WorkflowDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Workflow-Definition muss ein JSON-Objekt sein.');
  }
  const record = value as Record<string, unknown>;
  const triggerRaw = (record['trigger'] ?? {}) as Record<string, unknown>;
  const triggerType = String(triggerRaw['type'] ?? 'manual').toLowerCase();
  if (triggerType !== 'manual' && triggerType !== 'schedule') {
    throw new Error("Trigger muss 'manual' oder 'schedule' sein.");
  }
  const stepsRaw = record['steps'];
  if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
    throw new Error('Workflow benötigt mindestens einen Schritt.');
  }
  const steps: WorkflowStep[] = stepsRaw.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Schritt ${index + 1} ist kein Objekt.`);
    }
    const step = entry as Record<string, unknown>;
    const type = String(step['type'] ?? '').trim();
    if (!type) throw new Error(`Schritt ${index + 1} benötigt ein 'type'.`);
    return { ...(step as WorkflowStep), type };
  });

  return {
    trigger: {
      type: triggerType,
      ...(triggerType === 'schedule'
        ? { intervalSeconds: sanitizeInterval(triggerRaw['intervalSeconds']) || 900 }
        : {}),
    },
    steps,
  };
}

export class WorkflowStore {
  readonly file: string;
  private data: Workflow[];

  constructor(file = path.join(config.paths.baseDir, 'workflows.json')) {
    this.file = file;
    this.data = readJsonFile<Workflow[]>(file, []).map((entry) => ({
      ...entry,
      kind: entry.kind ?? 'webhook',
    }));
    if (this.data.length === 0) {
      this.data = this.seed();
      if (this.data.length) this.persist();
    }
  }

  private seed(): Workflow[] {
    return Object.entries(config.n8n.webhooks).map(([name, webhookUrl]) => ({
      id: crypto.randomUUID(),
      name,
      kind: 'webhook' as const,
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
    return this.data.map((workflow) => structuredClone(workflow));
  }

  get(id: string): Workflow | null {
    const workflow = this.data.find((entry) => entry.id === id);
    return workflow ? structuredClone(workflow) : null;
  }

  findByName(name: string): Workflow | null {
    const workflow = this.data.find((entry) => entry.name === name);
    return workflow ? structuredClone(workflow) : null;
  }

  add(input: WorkflowInput): Workflow {
    const name = String(input.name ?? '').trim();
    if (!name) throw new Error('Name darf nicht leer sein.');

    const wantsInternal =
      String(input.kind ?? '').toLowerCase() === 'internal' || input.definition !== undefined;
    const definition = wantsInternal ? sanitizeDefinition(input.definition) : undefined;
    const webhookUrl = sanitizeUrl(input.webhookUrl);

    if (!wantsInternal && !webhookUrl) {
      throw new Error('Webhook-URL darf nicht leer sein (oder internen Workflow anlegen).');
    }

    const intervalSeconds =
      definition?.trigger.type === 'schedule'
        ? sanitizeInterval(definition.trigger.intervalSeconds)
        : sanitizeInterval(input.intervalSeconds);

    const workflow: Workflow = {
      id: crypto.randomUUID(),
      name: name.slice(0, 120),
      kind: wantsInternal ? 'internal' : 'webhook',
      webhookUrl: wantsInternal ? webhookUrl : webhookUrl,
      ...(definition ? { definition } : {}),
      enabled: input.enabled === undefined ? true : Boolean(input.enabled),
      intervalSeconds,
      createdAt: new Date().toISOString(),
      lastRun: null,
      lastStatus: null,
      lastHttpStatus: null,
      lastError: null,
      runCount: 0,
    };
    this.data.push(workflow);
    this.persist();
    return structuredClone(workflow);
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
    if (input.definition !== undefined) {
      workflow.definition = sanitizeDefinition(input.definition);
      workflow.kind = 'internal';
      workflow.intervalSeconds =
        workflow.definition.trigger.type === 'schedule'
          ? sanitizeInterval(workflow.definition.trigger.intervalSeconds)
          : 0;
    } else if (input.intervalSeconds !== undefined) {
      workflow.intervalSeconds = sanitizeInterval(input.intervalSeconds);
      if (workflow.definition) {
        workflow.definition.trigger.type =
          workflow.intervalSeconds > 0 ? 'schedule' : 'manual';
        if (workflow.intervalSeconds > 0) {
          workflow.definition.trigger.intervalSeconds = workflow.intervalSeconds;
        }
      }
    }
    this.persist();
    return structuredClone(workflow);
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
      .map((workflow) => structuredClone(workflow));
  }

  enabledNames(): string[] {
    return this.data.filter((workflow) => workflow.enabled).map((workflow) => workflow.name);
  }
}

export const workflowStore = new WorkflowStore();

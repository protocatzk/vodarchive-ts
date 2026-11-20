import crypto from 'node:crypto';
import path from 'node:path';
import { config } from '../config';
import { logger } from '../logger';
import { readJsonFile, writeJsonFileAtomic } from '../util/json';

export type ExecutionStatus = 'running' | 'success' | 'failed';
export type StepStatus = 'ok' | 'error' | 'skipped';

export interface ExecutionStepLog {
  id: string;
  type: string;
  name?: string;
  status: StepStatus;
  startedAt: number;
  finishedAt: number;
  error?: string;
  output?: unknown;
}

export interface ExecutionRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  trigger: string;
  startedAt: number;
  finishedAt: number | null;
  status: ExecutionStatus;
  error?: string;
  steps: ExecutionStepLog[];
}

const MAX_EXECUTIONS = 200;

export class ExecutionStore {
  readonly file: string;
  private data: ExecutionRecord[];

  constructor(file = path.join(config.paths.baseDir, 'executions.json')) {
    this.file = file;
    this.data = readJsonFile<ExecutionRecord[]>(file, []);
  }

  private persist(): void {
    try {
      writeJsonFileAtomic(this.file, this.data, 0o600);
    } catch (error) {
      logger.warn(`Ausführungen konnten nicht gespeichert werden: ${String(error)}`);
    }
  }

  list(limit = 50, workflowId?: string): ExecutionRecord[] {
    const filtered = workflowId
      ? this.data.filter((entry) => entry.workflowId === workflowId)
      : this.data;
    return filtered.slice(0, Math.max(1, limit)).map((entry) => structuredClone(entry));
  }

  get(id: string): ExecutionRecord | null {
    const record = this.data.find((entry) => entry.id === id);
    return record ? structuredClone(record) : null;
  }

  create(input: {
    workflowId: string;
    workflowName: string;
    trigger: string;
  }): ExecutionRecord {
    const record: ExecutionRecord = {
      id: crypto.randomUUID(),
      workflowId: input.workflowId,
      workflowName: input.workflowName,
      trigger: input.trigger,
      startedAt: Date.now(),
      finishedAt: null,
      status: 'running',
      steps: [],
    };
    this.data.unshift(record);
    if (this.data.length > MAX_EXECUTIONS) this.data.length = MAX_EXECUTIONS;
    this.persist();
    return structuredClone(record);
  }

  addStep(
    id: string,
    step: Omit<ExecutionStepLog, 'id' | 'startedAt'> & { id?: string; startedAt?: number },
  ): ExecutionStepLog {
    const record = this.data.find((entry) => entry.id === id);
    const log: ExecutionStepLog = {
      id: step.id ?? crypto.randomUUID(),
      type: step.type,
      ...(step.name ? { name: step.name } : {}),
      status: step.status,
      startedAt: step.startedAt ?? Date.now(),
      finishedAt: step.finishedAt ?? Date.now(),
      ...(step.error ? { error: step.error } : {}),
      ...(step.output !== undefined ? { output: step.output } : {}),
    };
    if (record) {
      record.steps.push(log);
      this.persist();
    }
    return log;
  }

  finish(
    id: string,
    result: { status: ExecutionStatus; error?: string },
  ): void {
    const record = this.data.find((entry) => entry.id === id);
    if (!record) return;
    record.status = result.status;
    record.finishedAt = Date.now();
    if (result.error) record.error = result.error;
    this.persist();
  }

  clear(workflowId?: string): number {
    const before = this.data.length;
    this.data = workflowId
      ? this.data.filter((entry) => entry.workflowId !== workflowId)
      : [];
    this.persist();
    return before - this.data.length;
  }
}

export const executionStore = new ExecutionStore();

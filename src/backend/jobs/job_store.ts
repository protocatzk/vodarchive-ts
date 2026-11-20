import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger';

/**
 * Persistenter Job-Spool fuer den VOD-Uploader.
 *
 * Haelt angenommene Jobs inklusive Fortschritt (Download, Split, bereits
 * hochgeladene Telegram-Teile) auf einem Volume fest, damit ein Neustart oder
 * Deploy laufende Uploads nicht mehr verwirft.
 */

export type JobStatus = 'queued' | 'running' | 'failed' | 'done' | 'cancelled';
export type JobPayload = Record<string, unknown>;

export interface JobRecord {
  key: string;
  job_id: string;
  payload: JobPayload;
  status: JobStatus;
  stage: string;
  attempts: number;
  error: string | null;
  job_dir: string;
  downloaded: boolean;
  downloaded_size: number;
  parts: unknown[];
  uploaded_message_ids: number[];
  forum_message_ids: number[];
  topic_id: number | null;
  created_at: string;
  updated_at: string;
  [field: string]: unknown;
}

export function utcnow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function safeName(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120);
  return cleaned || 'job';
}

export function makeKey(data: Record<string, unknown>): string {
  const recordingId = String(data['recording_id'] ?? '').trim();
  const source = String(data['source'] ?? 'streamrecorder').trim().toLowerCase();
  let basis: string;
  if (recordingId) {
    basis = `${source}:${recordingId}`;
  } else {
    const rawBasis =
      data['download_url'] ?? data['source_url'] ?? JSON.stringify(sortKeys(data));
    basis = `${source}:${String(rawBasis)}`;
  }
  if (basis.length > 200) {
    basis = 'hash:' + crypto.createHash('sha256').update(basis, 'utf8').digest('hex');
  }
  return safeName(basis);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => [key, sortKeys(val)]);
    return Object.fromEntries(entries);
  }
  return value;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class JobStore {
  readonly baseDir: string;
  readonly jobsDir: string;
  readonly jobsFile: string;
  readonly doneFile: string;
  private readonly doneTtl: number;
  private readonly staleSeconds: number;
  private readonly failedTtl: number;

  private jobs: Record<string, JobRecord>;
  private done: Record<string, number>;

  constructor(baseDir: string, doneTtlDays = 14, staleDays = 3, failedTtlDays = 30) {
    this.baseDir = path.resolve(baseDir);
    this.jobsDir = path.join(this.baseDir, 'jobs');
    this.jobsFile = path.join(this.baseDir, 'jobs.json');
    this.doneFile = path.join(this.baseDir, 'done.json');
    this.doneTtl = Math.max(1, doneTtlDays) * 86400;
    this.staleSeconds = Math.max(1, staleDays) * 86400;
    this.failedTtl = Math.max(1, failedTtlDays) * 86400;

    fs.mkdirSync(this.jobsDir, { recursive: true });
    this.jobs = this.read<Record<string, JobRecord>>(this.jobsFile, {});
    this.done = this.read<Record<string, number>>(this.doneFile, {});
    this.pruneDone();
    this.saveDone();
    this.pruneFailed();
    this.pruneDirs();
  }

  // ------------------------------------------------------------------ io
  private read<T>(file: string, fallback: T): T {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch {
      return fallback;
    }
  }

  private write(file: string, data: unknown): void {
    const tmpPath = `${file}.tmp`;
    const fd = fs.openSync(tmpPath, 'w');
    try {
      fs.writeSync(fd, JSON.stringify(data, null, 1));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmpPath, file);
  }

  private saveJobs(): void {
    this.write(this.jobsFile, this.jobs);
  }

  private saveDone(): void {
    this.write(this.doneFile, this.done);
  }

  // -------------------------------------------------------------- lookup
  static keyFor(data: Record<string, unknown>): string {
    return makeKey(data);
  }

  jobDirFor(key: string): string {
    return path.join(this.jobsDir, key);
  }

  get(key: string): JobRecord | null {
    const record = this.jobs[key];
    return record ? clone(record) : null;
  }

  isDone(key: string): boolean {
    return key in this.done;
  }

  pending(): JobRecord[] {
    const records = Object.values(this.jobs)
      .filter((record) => record.status === 'queued' || record.status === 'running')
      .map((record) => clone(record));
    records.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    return records;
  }

  // -------------------------------------------------------------- mutate
  create(key: string, payload: JobPayload, jobId: string): JobRecord {
    const existing = this.get(key);
    if (existing) return existing;

    const record: JobRecord = {
      key,
      job_id: jobId,
      payload,
      status: 'queued',
      stage: 'queued',
      attempts: 0,
      error: null,
      job_dir: this.jobDirFor(key),
      downloaded: false,
      downloaded_size: 0,
      parts: [],
      uploaded_message_ids: [],
      forum_message_ids: [],
      topic_id: null,
      created_at: utcnow(),
      updated_at: utcnow(),
    };
    fs.mkdirSync(record.job_dir, { recursive: true });
    this.jobs[key] = record;
    this.saveJobs();
    return clone(record);
  }

  update(key: string, fields: Partial<JobRecord>): JobRecord {
    const record = this.jobs[key];
    if (!record) throw new Error(`Unknown job key: ${key}`);
    Object.assign(record, fields);
    record.updated_at = utcnow();
    this.saveJobs();
    return clone(record);
  }

  markRunning(key: string, stage?: string): JobRecord {
    const record = this.jobs[key];
    const attempts = Number(record?.attempts ?? 0) + 1;
    const fields: Partial<JobRecord> = { status: 'running', attempts, error: null };
    if (stage) fields.stage = stage;
    return this.update(key, fields);
  }

  complete(key: string, status: JobStatus = 'done', remember = true): void {
    const record = this.jobs[key];
    if (record) {
      delete this.jobs[key];
      this.saveJobs();
    }
    if (remember) {
      this.done[key] = Date.now() / 1000;
      this.saveDone();
    }
    this.removeJobDir(key);
  }

  fail(key: string, error: string): void {
    this.update(key, { status: 'failed', error: String(error).slice(0, 1000) });
  }

  touch(key: string): void {
    this.update(key, {});
  }

  remove(key: string): void {
    if (this.jobs[key]) {
      delete this.jobs[key];
      this.saveJobs();
    }
    this.removeJobDir(key);
  }

  // ------------------------------------------------------------- cleanup
  removeJobDir(key: string): void {
    fs.rmSync(this.jobDirFor(key), { recursive: true, force: true });
  }

  private pruneDone(): void {
    const cutoff = Date.now() / 1000 - this.doneTtl;
    const next: Record<string, number> = {};
    for (const [key, ts] of Object.entries(this.done)) {
      if (Number(ts) >= cutoff) next[key] = ts;
    }
    this.done = next;
  }

  private static recordTimestamp(record: JobRecord): number {
    for (const field of ['updated_at', 'created_at'] as const) {
      const raw = record[field];
      if (!raw) continue;
      const parsed = Date.parse(String(raw));
      if (!Number.isNaN(parsed)) return parsed / 1000;
    }
    return 0;
  }

  private pruneFailed(): void {
    const cutoff = Date.now() / 1000 - this.failedTtl;
    const removed: string[] = [];
    for (const [key, record] of Object.entries(this.jobs)) {
      if (record.status !== 'failed') continue;
      const updated = JobStore.recordTimestamp(record);
      if (updated && updated < cutoff) {
        delete this.jobs[key];
        removed.push(key);
      }
    }
    if (removed.length) {
      this.saveJobs();
      for (const key of removed) this.removeJobDir(key);
    }
  }

  private pruneDirs(): void {
    const referenced = new Set(
      Object.entries(this.jobs).map(([key, record]) => record.key || key),
    );
    const cutoff = Date.now() / 1000 - this.staleSeconds;
    let entries: string[];
    try {
      entries = fs.readdirSync(this.jobsDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(this.jobsDir, entry);
      if (!fs.statSync(full, { throwIfNoEntry: false })?.isDirectory()) continue;
      if (referenced.has(entry)) continue;
      const mtime = fs.statSync(full, { throwIfNoEntry: false })?.mtimeMs;
      if (mtime !== undefined && mtime / 1000 < cutoff) {
        fs.rmSync(full, { recursive: true, force: true });
        logger.info(`Veraltetes Job-Verzeichnis entfernt: ${entry}`);
      }
    }
  }

  summary(): Record<string, unknown> {
    return {
      dir: this.baseDir,
      pending: this.pending().length,
      done_entries: Object.keys(this.done).length,
      jobs: this.pending().map((record) => ({
        key: record.key,
        job_id: record.job_id,
        stage: record.stage,
        status: record.status,
        attempts: record.attempts,
      })),
    };
  }
}

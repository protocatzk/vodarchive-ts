import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { logger } from '../logger';
import { readJsonFile, writeJsonFileAtomic } from '../util/json';

export type SourceType = 'rss' | 'opml';

export interface Source {
  id: string;
  name: string;
  type: SourceType;
  url: string;
  enabled: boolean;
  pollIntervalSeconds: number | null;
  createdAt: string;
  lastCheck: number | null;
  lastOk: boolean | null;
  lastError: string | null;
  lastItems: number;
  archivedCount: number;
}

export interface SourceInput {
  name?: unknown;
  type?: unknown;
  url?: unknown;
  enabled?: unknown;
  pollIntervalSeconds?: unknown;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function sanitizeType(value: unknown): SourceType {
  const type = String(value ?? '').trim().toLowerCase();
  if (type !== 'rss' && type !== 'opml') {
    throw new Error("Typ muss 'rss' oder 'opml' sein.");
  }
  return type;
}

function sanitizeUrl(value: unknown): string {
  const url = String(value ?? '').trim();
  if (!url) throw new Error('URL darf nicht leer sein.');
  if (url.length > 2048) throw new Error('URL ist zu lang.');
  return url;
}

function sanitizeInterval(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(60, Math.min(86400, parsed));
}

export class SourceStore {
  readonly file: string;
  private data: Source[];

  constructor(file = path.join(config.paths.baseDir, 'sources.json')) {
    this.file = file;
    this.data = readJsonFile<Source[]>(file, []);
    if (this.data.length === 0) {
      this.data = this.seed();
      if (this.data.length) this.persist();
    }
  }

  private seed(): Source[] {
    const sources: Source[] = [];
    config.rss.feedUrls.forEach((url, index) => {
      sources.push({
        id: crypto.randomUUID(),
        name: config.rss.feedTitles[index] || hostOf(url) || `Feed ${index + 1}`,
        type: 'rss',
        url,
        enabled: true,
        pollIntervalSeconds: null,
        createdAt: new Date().toISOString(),
        lastCheck: null,
        lastOk: null,
        lastError: null,
        lastItems: 0,
        archivedCount: 0,
      });
    });
    const opml = config.rss.opmlFile;
    if (opml && fs.existsSync(opml)) {
      sources.push({
        id: crypto.randomUUID(),
        name: 'OPML (lokal)',
        type: 'opml',
        url: opml,
        enabled: true,
        pollIntervalSeconds: null,
        createdAt: new Date().toISOString(),
        lastCheck: null,
        lastOk: null,
        lastError: null,
        lastItems: 0,
        archivedCount: 0,
      });
    }
    return sources;
  }

  private persist(): void {
    try {
      writeJsonFileAtomic(this.file, this.data, 0o600);
    } catch (error) {
      logger.warn(`Quellen konnten nicht gespeichert werden: ${String(error)}`);
    }
  }

  list(): Source[] {
    return this.data.map((source) => ({ ...source }));
  }

  get(id: string): Source | null {
    const source = this.data.find((entry) => entry.id === id);
    return source ? { ...source } : null;
  }

  listEnabled(): Source[] {
    return this.data.filter((source) => source.enabled).map((source) => ({ ...source }));
  }

  add(input: SourceInput): Source {
    const type = sanitizeType(input.type);
    const url = sanitizeUrl(input.url);
    const name = String(input.name ?? '').trim() || hostOf(url) || url;
    const source: Source = {
      id: crypto.randomUUID(),
      name: name.slice(0, 200),
      type,
      url,
      enabled: input.enabled === undefined ? true : Boolean(input.enabled),
      pollIntervalSeconds: sanitizeInterval(input.pollIntervalSeconds),
      createdAt: new Date().toISOString(),
      lastCheck: null,
      lastOk: null,
      lastError: null,
      lastItems: 0,
      archivedCount: 0,
    };
    this.data.push(source);
    this.persist();
    return { ...source };
  }

  update(id: string, input: SourceInput): Source {
    const source = this.data.find((entry) => entry.id === id);
    if (!source) throw new Error('Quelle nicht gefunden.');
    if (input.name !== undefined) {
      const name = String(input.name).trim();
      if (!name) throw new Error('Name darf nicht leer sein.');
      source.name = name.slice(0, 200);
    }
    if (input.type !== undefined) source.type = sanitizeType(input.type);
    if (input.url !== undefined) source.url = sanitizeUrl(input.url);
    if (input.enabled !== undefined) source.enabled = Boolean(input.enabled);
    if (input.pollIntervalSeconds !== undefined) {
      source.pollIntervalSeconds = sanitizeInterval(input.pollIntervalSeconds);
    }
    this.persist();
    return { ...source };
  }

  remove(id: string): boolean {
    const index = this.data.findIndex((entry) => entry.id === id);
    if (index === -1) return false;
    this.data.splice(index, 1);
    this.persist();
    return true;
  }

  markChecked(
    id: string,
    result: { ok: boolean; error?: string | null; items?: number },
  ): void {
    const source = this.data.find((entry) => entry.id === id);
    if (!source) return;
    source.lastCheck = nowSeconds();
    source.lastOk = result.ok;
    source.lastError = result.ok ? null : (result.error ?? 'Unbekannter Fehler');
    if (typeof result.items === 'number') source.lastItems = result.items;
    this.persist();
  }

  incrementArchived(id: string): void {
    const source = this.data.find((entry) => entry.id === id);
    if (!source) return;
    source.archivedCount += 1;
    this.persist();
  }

  configured(): boolean {
    return config.rss.feedUrls.length > 0 || Boolean(config.rss.opmlFile && fs.existsSync(config.rss.opmlFile));
  }
}

export const sourceStore = new SourceStore();

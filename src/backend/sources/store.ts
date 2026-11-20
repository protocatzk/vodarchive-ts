import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { logger } from '../logger';
import { readJsonFile, writeJsonFileAtomic } from '../util/json';

export type SourceType = 'rss' | 'opml' | 'ytdlp' | 'streamrecorder';

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
  /** Streamrecorder: Session-Cookie (nie in API-Antworten ausgeliefert). */
  cookie?: string;
  cookieSet?: boolean;
  /** Streamrecorder: Basis-URL der API. */
  apiBaseUrl?: string;
  /** Streamrecorder: Listen-Endpunkt (Default /api/user/recordingsv2). */
  listPath?: string;
  /** Streamrecorder: Anzahl der zu ladenden Aufnahmen pro Target. */
  limit?: number;
  /** Streamrecorder: Pfad zum Array in der Antwort (leer = auto). */
  itemsPath?: string;
  /** Streamrecorder: optionale Ziel-/Kanal-Filter. */
  targets?: string[];
  /** Streamrecorder: Mapping logischer Felder auf Antwort-Felder. */
  fieldMap?: Record<string, string>;
  /** Streamrecorder: beim ersten Lauf vorhandene Aufnahmen überspringen. */
  initialBackfill?: boolean;
  /** Streamrecorder: nur nicht heruntergeladene Aufnahmen übernehmen. */
  onlyNew?: boolean;
  /** Streamrecorder: nur loggen, nichts einreihen/hochladen. */
  dryRun?: boolean;
  /** Streamrecorder: Test-Upload ohne setdownloaded-Markierung. */
  testMode?: boolean;
  /** Streamrecorder: Ziel-Chat für Test-Uploads (optional). */
  testChatId?: string;
  /** Streamrecorder: Ziel-Forum für Test-Uploads (optional). */
  testForumChatId?: string;
}

export interface SourceInput {
  name?: unknown;
  type?: unknown;
  url?: unknown;
  enabled?: unknown;
  pollIntervalSeconds?: unknown;
  cookie?: unknown;
  apiBaseUrl?: unknown;
  listPath?: unknown;
  limit?: unknown;
  itemsPath?: unknown;
  targets?: unknown;
  fieldMap?: unknown;
  initialBackfill?: unknown;
  onlyNew?: unknown;
  dryRun?: unknown;
  testMode?: unknown;
  testChatId?: unknown;
  testForumChatId?: unknown;
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
  if (type !== 'rss' && type !== 'opml' && type !== 'ytdlp' && type !== 'streamrecorder') {
    throw new Error("Typ muss 'rss', 'opml', 'ytdlp' oder 'streamrecorder' sein.");
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

function toBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  return fallback;
}

function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function toFieldMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, mapped] of Object.entries(value as Record<string, unknown>)) {
    const text = String(mapped ?? '').trim();
    if (text) result[key] = text;
  }
  return result;
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

  private mask(source: Source): Source {
    const copy = { ...source };
    copy.cookieSet = Boolean(copy.cookie);
    copy.cookie = '';
    return copy;
  }

  list(): Source[] {
    return this.data.map((source) => this.mask(source));
  }

  /** Interne Sicht inkl. Cookie – nur für den Archiver. */
  listEnabled(): Source[] {
    return this.data.filter((source) => source.enabled).map((source) => ({ ...source }));
  }

  get(id: string): Source | null {
    const source = this.data.find((entry) => entry.id === id);
    return source ? this.mask(source) : null;
  }

  getInternal(id: string): Source | null {
    const source = this.data.find((entry) => entry.id === id);
    return source ? { ...source } : null;
  }

  add(input: SourceInput): Source {
    const type = sanitizeType(input.type);
    let rawUrl = String(input.url ?? '').trim();
    if (type === 'streamrecorder' && !rawUrl) {
      rawUrl = String(input.apiBaseUrl ?? config.streamrecorder.apiBaseUrl).trim();
    }
    const url = sanitizeUrl(rawUrl);
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

    if (type === 'streamrecorder') {
      source.cookie = String(input.cookie ?? config.streamrecorder.cookie ?? '').trim();
      source.apiBaseUrl = String(
        input.apiBaseUrl ?? rawUrl ?? config.streamrecorder.apiBaseUrl,
      ).trim();
      source.listPath = String(input.listPath ?? '/api/user/recordingsv2').trim();
      source.limit = Math.max(1, Math.min(100, Number(input.limit ?? 10) || 10));
      source.itemsPath = String(input.itemsPath ?? '').trim();
      source.targets = toList(input.targets);
      source.fieldMap = toFieldMap(input.fieldMap);
      source.initialBackfill = toBool(input.initialBackfill, false);
      source.onlyNew = toBool(input.onlyNew, true);
      source.dryRun = toBool(input.dryRun, false);
      source.testMode = toBool(input.testMode, false);
      source.testChatId = String(input.testChatId ?? '').trim();
      source.testForumChatId = String(input.testForumChatId ?? '').trim();
    }

    this.data.push(source);
    this.persist();
    return this.mask(source);
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

    if (source.type === 'streamrecorder') {
      // Leeres Cookie = bestehendes beibehalten.
      if (input.cookie !== undefined && input.cookie !== null && input.cookie !== '') {
        source.cookie = String(input.cookie).trim();
      }
      if (input.apiBaseUrl !== undefined) {
        source.apiBaseUrl = String(input.apiBaseUrl).trim() || config.streamrecorder.apiBaseUrl;
      }
      if (input.listPath !== undefined) {
        source.listPath = String(input.listPath).trim() || '/api/user/recordingsv2';
      }
      if (input.limit !== undefined) {
        source.limit = Math.max(1, Math.min(100, Number(input.limit) || 10));
      }
      if (input.itemsPath !== undefined) source.itemsPath = String(input.itemsPath).trim();
      if (input.targets !== undefined) source.targets = toList(input.targets);
      if (input.fieldMap !== undefined) source.fieldMap = toFieldMap(input.fieldMap);
      if (input.initialBackfill !== undefined) {
        source.initialBackfill = toBool(input.initialBackfill, false);
      }
      if (input.onlyNew !== undefined) source.onlyNew = toBool(input.onlyNew, true);
      if (input.dryRun !== undefined) source.dryRun = toBool(input.dryRun, false);
      if (input.testMode !== undefined) source.testMode = toBool(input.testMode, false);
      if (input.testChatId !== undefined) source.testChatId = String(input.testChatId).trim();
      if (input.testForumChatId !== undefined) {
        source.testForumChatId = String(input.testForumChatId).trim();
      }
    }

    this.persist();
    return this.mask(source);
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
    return (
      config.rss.feedUrls.length > 0 ||
      Boolean(config.rss.opmlFile && fs.existsSync(config.rss.opmlFile))
    );
  }
}

export const sourceStore = new SourceStore();

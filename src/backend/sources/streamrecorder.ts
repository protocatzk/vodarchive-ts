import crypto from 'node:crypto';
import { config } from '../config';
import type { Source } from './store';

/**
 * Streamrecorder-Integration – übernimmt die Logik der bisherigen n8n-Workflows:
 *   1. GET /userrecordings            (HTML) -> Target-IDs/Accounts einlesen
 *   2. GET /api/user/recordingsv2     (JSON) -> fertige, nicht heruntergeladene Aufnahmen
 *   3. POST /api/user/setdownloaded   -> erledigt die Upload-Pipeline nach Erfolg
 */

export interface StreamrecorderTarget {
  id: string;
  name: string;
  platform: string;
}

export interface StreamrecorderItem {
  id: string;
  title: string;
  streamer: string;
  url: string;
  thumbnail: string | null;
  published: number | null;
  platform: string;
  recordingId: string;
  recordedAt: string;
  duration: string;
  filesizeMb: number;
  resolution: string;
  category: string;
  maxViewers: number;
  avgViewers: number;
  deletionTime: string;
  playerUrl: string;
  targetId: string;
}

export interface StreamrecorderFetchResult {
  items: StreamrecorderItem[];
  targets: StreamrecorderTarget[];
  total: number;
  sample: Record<string, unknown> | null;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

function baseOf(source: Source): string {
  return (source.apiBaseUrl || source.url || config.streamrecorder.apiBaseUrl).replace(/\/+$/, '');
}

function cookieOf(source: Source): string {
  return (source.cookie || config.streamrecorder.cookie || '').trim();
}

function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isDownloaded(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return String(value ?? '').toLowerCase() === 'true';
}

function parsePublished(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value > 1e12 ? Math.floor(value / 1000) : value;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const parsed = Number.parseInt(text, 10);
    return parsed > 1e12 ? Math.floor(parsed / 1000) : parsed;
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : Math.floor(parsed / 1000);
}

function platformOf(value: unknown): string {
  const text = String(value ?? '').trim().toLowerCase();
  return text || 'streamrecorder';
}

function parseTargets(html: string, base: string): StreamrecorderTarget[] {
  if (!html.includes('recordings-streamer-card')) {
    if (/\/_af\/login|\/login\b/.test(html)) {
      throw new Error('Streamrecorder: Login-Seite statt Aufnahmen – Session-Cookie abgelaufen?');
    }
    throw new Error('Streamrecorder: Target-Liste nicht gefunden (Cookie ungültig oder Layout geändert?).');
  }

  const targets: StreamrecorderTarget[] = [];
  const seen = new Set<string>();
  for (const chunk of html.split('<div class="recordings-streamer-card"').slice(1)) {
    const end = chunk.indexOf('>');
    const tag = end >= 0 ? chunk.slice(0, end) : chunk.slice(0, 2000);
    const idMatch = /id="target-(\d+)"/.exec(tag);
    if (!idMatch || seen.has(idMatch[1] as string)) continue;
    seen.add(idMatch[1] as string);
    const nameMatch = /data-sr-target="([^"]*)"/.exec(tag);
    const platformMatch = /data-sr-target-platform="([^"]*)"/.exec(tag);
    targets.push({
      id: idMatch[1] as string,
      name: nameMatch ? nameMatch[1] as string : '',
      platform: platformMatch ? platformMatch[1] as string : '',
    });
  }
  if (targets.length === 0) {
    throw new Error('Streamrecorder: keine TargetIDs auf /userrecordings gefunden.');
  }
  void base;
  return targets;
}

async function fetchText(url: string, cookie: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Cookie: cookie,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Referer: 'https://streamrecorder.io/userrecordings',
        'User-Agent': UA,
      },
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Cookie ungültig oder abgelaufen (HTTP ${response.status}).`);
    }
    if (!response.ok) throw new Error(`Streamrecorder antwortet HTTP ${response.status}.`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url: string, cookie: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Cookie: cookie,
        Accept: 'application/json',
        Referer: 'https://streamrecorder.io/userrecordings',
        'User-Agent': UA,
      },
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Cookie ungültig oder abgelaufen (HTTP ${response.status}).`);
    }
    if (!response.ok) throw new Error(`Streamrecorder antwortet HTTP ${response.status}.`);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Antwort ist kein JSON (evtl. Login-Seite statt API).');
    }
  } finally {
    clearTimeout(timer);
  }
}

function mapRecording(
  raw: Record<string, unknown>,
  target: StreamrecorderTarget,
): StreamrecorderItem | null {
  if (String(raw['status'] ?? '').toLowerCase() !== 'finished') return null;
  const sources = Array.isArray(raw['sources'])
    ? (raw['sources'] as Array<Record<string, unknown>>)
    : [];
  if (sources.length === 0) return null;
  const source = sources[0];
  if (!source) return null;

  const link = String(source['downloadlink'] ?? '').trim();
  if (!link) return null;

  const id = String(raw['id'] ?? '').trim();
  if (!id) return null;

  const token = String(raw['token'] ?? '').trim();
  const filesize = num(source['filesize']);

  return {
    id,
    title: String(raw['streamtitle'] ?? 'No Title').trim() || 'No Title',
    streamer: String(raw['target_name'] ?? target.name ?? target.id).trim() || target.name || target.id,
    url: link,
    thumbnail:
      String(raw['thumb_large'] ?? '').trim() ||
      String(raw['poster_small_270'] ?? '').trim() ||
      null,
    published: parsePublished(raw['recorded_at']),
    platform: platformOf(raw['target_platform'] ?? target.platform),
    recordingId: id,
    recordedAt: String(raw['recorded_at'] ?? '').trim(),
    duration: String(raw['duration_hr'] ?? '').trim(),
    filesizeMb: Math.round(filesize / 1024 / 1024),
    resolution: String(source['resolution'] ?? '').trim(),
    category: String(raw['streamcategory'] ?? '').trim(),
    maxViewers: num(raw['max_viewercount']),
    avgViewers: num(raw['avg_viewercount']),
    deletionTime: String(source['deletiontime_hr'] ?? '').trim(),
    playerUrl: token ? `https://streamrecorder.io/userrecordings/recording/${token}` : '',
    targetId: String(raw['targetid'] ?? target.id).trim(),
  };
}

/** Lädt Targets + Aufnahmen für einen Streamrecorder-Account (Cookie). */
export async function fetchStreamrecorder(source: Source): Promise<StreamrecorderFetchResult> {
  const base = baseOf(source);
  const cookie = cookieOf(source);
  if (!cookie) throw new Error('Streamrecorder-Cookie fehlt.');

  const targetsHtml = await fetchText(`${base}/userrecordings`, cookie);
  let targets = parseTargets(targetsHtml, base);

  const wanted = source.targets ?? [];
  if (wanted.length > 0) {
    targets = targets.filter((target) => {
      const id = target.id;
      const name = target.name.toLowerCase();
      return wanted.some((entry) => {
        const needle = entry.toLowerCase();
        return id === entry || name === needle || name.includes(needle);
      });
    });
    if (targets.length === 0) {
      throw new Error(`Kein Target passt zu den Filtern: ${wanted.join(', ')}`);
    }
  }

  const listPath = source.listPath?.trim() || '/api/user/recordingsv2';
  const limit = Math.max(1, Math.min(100, source.limit ?? 10));
  const items: StreamrecorderItem[] = [];
  let total = 0;
  let sample: Record<string, unknown> | null = null;

  for (const target of targets) {
    const url = new URL(`${base}${listPath.startsWith('/') ? listPath : `/${listPath}`}`);
    url.searchParams.set('targetid', target.id);
    url.searchParams.set('offset', '0');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('sortby', 'id');
    url.searchParams.set('sortdir', 'desc');

    const payload = await fetchJson(url.toString(), cookie);
    const data =
      payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>)['data'])
        ? ((payload as Record<string, unknown>)['data'] as unknown[])
        : Array.isArray(payload)
          ? payload
          : [];

    total += data.length;
    if (!sample && data[0] && typeof data[0] === 'object') {
      sample = {};
      for (const [key, value] of Object.entries(data[0] as Record<string, unknown>)) {
        if (/cookie|token|session|auth|password|secret/i.test(key)) continue;
        const text = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
        sample[key] = text.length > 160 ? `${text.slice(0, 160)}…` : text;
      }
    }

    for (const entry of data) {
      if (!entry || typeof entry !== 'object') continue;
      const raw = entry as Record<string, unknown>;
      if (source.onlyNew !== false && isDownloaded(raw['downloaded'])) continue;
      const mapped = mapRecording(raw, target);
      if (mapped) items.push(mapped);
    }
  }

  items.sort((a, b) => (b.published ?? 0) - (a.published ?? 0));
  return { items, targets, total, sample };
}

export interface StreamrecorderPreview {
  ok: boolean;
  total: number;
  items: number;
  targets: number;
  sample: Record<string, unknown> | null;
  error?: string;
}

/** Prüft Cookie, Targets und Aufnahmen, ohne etwas zu speichern. */
export async function previewStreamrecorder(input: {
  apiBaseUrl?: string;
  cookie?: string;
  listPath?: string;
  itemsPath?: string;
  targets?: string[];
  onlyNew?: boolean;
  limit?: number;
}): Promise<StreamrecorderPreview> {
  const source = {
    id: 'preview',
    name: 'preview',
    type: 'streamrecorder',
    url: input.apiBaseUrl || config.streamrecorder.apiBaseUrl,
    enabled: true,
    pollIntervalSeconds: null,
    createdAt: new Date().toISOString(),
    lastCheck: null,
    lastOk: null,
    lastError: null,
    lastItems: 0,
    archivedCount: 0,
    cookie: input.cookie || config.streamrecorder.cookie,
    apiBaseUrl: input.apiBaseUrl || config.streamrecorder.apiBaseUrl,
    listPath: input.listPath || '/api/user/recordingsv2',
    itemsPath: input.itemsPath || '',
    targets: input.targets ?? [],
    onlyNew: input.onlyNew ?? true,
    limit: input.limit ?? 10,
  } as Source;

  try {
    const result = await fetchStreamrecorder(source);
    return {
      ok: true,
      total: result.total,
      items: result.items.length,
      targets: result.targets.length,
      sample: result.sample,
    };
  } catch (error) {
    return {
      ok: false,
      total: 0,
      items: 0,
      targets: 0,
      sample: null,
      error: (error as Error).message,
    };
  }
}

export function streamrecorderItemKey(item: StreamrecorderItem): string {
  return `sr-${item.recordingId || crypto.createHash('sha1').update(item.url).digest('hex').slice(0, 12)}`;
}

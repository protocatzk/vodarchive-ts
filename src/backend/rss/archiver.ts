import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { config } from '../config';
import { logger } from '../logger';

/**
 * RSS-Archiv (rss.app) – liest RSS-/Atom-Feeds (optional aus OPML), filtert
 * neue Eintraege und uebergibt sie per Callback an die Upload-Pipeline.
 */

export interface RssFeedInfo {
  title: string;
  url: string;
  source_url: string | null;
  bundle: boolean;
  child_count: number;
}

export interface RssItem {
  key: string;
  channel: string;
  title: string;
  url: string;
  published: number | null;
  thumbnail: string | null;
  platform: string;
  recordingId: string;
  publishedIso: string;
}

export type RssItemStatus = 'archived' | 'skipped' | 'failed' | 'retry' | 'live' | 'baseline';

export interface RssItemEntry {
  s: RssItemStatus;
  t: number;
  next?: number;
  r?: number;
  u?: string;
  ti?: string;
  ch?: string;
}

interface RssState {
  feeds: Record<string, { c?: number; o?: boolean; e?: string; n?: number }>;
  items: Record<string, RssItemEntry>;
  baseline_done?: boolean;
}

const EMPTY_STATE: RssState = { feeds: {}, items: {}, baseline_done: false };

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return textOf(value[0]);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('#text' in record) return textOf(record['#text']);
  }
  return '';
}

function linkOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return linkOf(value[0]);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('@_href' in record) return String(record['@_href']);
    if ('#text' in record) return textOf(record['#text']);
  }
  return '';
}

function parseDate(value: unknown): number | null {
  const text = textOf(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : parsed / 1000;
}

function isoDate(seconds: number | null): string {
  if (!seconds) return '';
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, '');
}

function makeItemKey(url: string): string {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
}

export class RssArchiver {
  readonly enabled = config.rss.enabled;
  private readonly opmlFile = config.rss.opmlFile;
  private readonly interval = config.rss.pollIntervalSeconds;
  private readonly maxRetries = config.rss.maxRetries;
  private readonly retryBaseSeconds = config.rss.retryBaseSeconds;
  private readonly retryMaxDelaySeconds = config.rss.retryMaxDelaySeconds;
  private readonly liveRecheckSeconds = config.rss.liveRecheckSeconds;
  private readonly liveMaxAgeDays = config.rss.liveMaxAgeDays;
  private readonly retryMaxAgeDays = config.rss.retryMaxAgeDays;
  private readonly maxItemsPerPoll = config.rss.maxItemsPerPoll;
  private readonly maxItemAgeHours = config.rss.maxItemAgeHours;
  private readonly initialBackfill = config.rss.initialBackfill;

  onItem: ((item: RssItem) => Promise<void>) | null = null;

  private feeds: RssFeedInfo[] = [];
  private state: RssState;
  private running = false;
  private blockedUntil = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastCookieMtime = 0;

  lastPollStarted: number | null = null;
  lastPollFinished: number | null = null;
  lastTrigger: string | null = null;
  lastError: string | null = null;
  lastSummary: unknown = null;
  recent: RssItem[] = [];

  constructor() {
    this.state = this.loadState();
    this.feeds = this.resolveFeeds();
  }

  // ------------------------------------------------------------------ setup

  private resolveFeeds(): RssFeedInfo[] {
    const feeds: RssFeedInfo[] = [];
    const seen = new Set<string>();

    const add = (title: string, url: string): void => {
      if (!url || seen.has(url)) return;
      seen.add(url);
      feeds.push({ title: title || hostOf(url), url, source_url: null, bundle: false, child_count: 0 });
    };

    config.rss.feedUrls.forEach((url, index) => {
      add(config.rss.feedTitles[index] ?? '', url);
    });

    if (this.opmlFile && fs.existsSync(this.opmlFile)) {
      try {
        const xml = fs.readFileSync(this.opmlFile, 'utf8');
        const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
        const doc = parser.parse(xml) as Record<string, unknown>;
        const body = (doc['opml'] as Record<string, unknown> | undefined)?.['body'];
        const outlines = extractOutlines(body);
        for (const outline of outlines) {
          const url = String(outline['@_xmlUrl'] ?? '').trim();
          const title = String(outline['@_title'] ?? outline['@_text'] ?? '').trim();
          add(title, url);
        }
      } catch (error) {
        logger.warn(`OPML-Datei konnte nicht gelesen werden: ${String(error)}`);
      }
    }

    return feeds;
  }

  private loadState(): RssState {
    try {
      const raw = fs.readFileSync(config.paths.rssStateFile, 'utf8');
      const parsed = JSON.parse(raw) as Partial<RssState>;
      return {
        feeds: parsed.feeds ?? {},
        items: parsed.items ?? {},
        baseline_done: parsed.baseline_done ?? false,
      };
    } catch {
      return structuredClone(EMPTY_STATE);
    }
  }

  private saveState(): void {
    try {
      fs.mkdirSync(path.dirname(config.paths.rssStateFile), { recursive: true });
      fs.writeFileSync(config.paths.rssStateFile, JSON.stringify(this.state, null, 1), 'utf8');
    } catch (error) {
      logger.warn(`RSS-State konnte nicht geschrieben werden: ${String(error)}`);
    }
  }

  // ------------------------------------------------------------------ status

  private counts(): Record<string, number> {
    const counts = { archived: 0, skipped: 0, failed: 0, retry: 0, live: 0, baseline: 0 };
    for (const entry of Object.values(this.state.items)) {
      if (entry.s in counts) counts[entry.s] += 1;
    }
    return counts;
  }

  private cookiesStatus(): Record<string, unknown> {
    const cookiesFile = config.ytdlp.cookiesFile;
    let exists = false;
    let mtime: number | null = null;
    let size: number | null = null;
    if (cookiesFile) {
      try {
        const stat = fs.statSync(cookiesFile);
        exists = true;
        mtime = stat.mtimeMs / 1000;
        size = stat.size;
        if (mtime !== this.lastCookieMtime) {
          this.lastCookieMtime = mtime;
          this.blockedUntil = 0;
        }
      } catch {
        exists = false;
      }
    }
    return {
      path: cookiesFile || null,
      exists,
      mtime,
      size,
      usable: exists,
      broken: false,
      reason: '',
    };
  }

  status(): Record<string, unknown> {
    const feeds = this.feeds.map((feed) => {
      const info = this.state.feeds[feed.url] ?? {};
      return {
        title: feed.title,
        bundle: feed.bundle,
        child_count: feed.child_count,
        host: hostOf(feed.source_url ?? feed.url),
        last_check: info.c ?? null,
        ok: info.o ?? null,
        error: info.e ?? null,
        items: info.n ?? 0,
      };
    });

    return {
      enabled: this.enabled,
      running: this.running,
      polling: this.running,
      processing: this.running,
      queue: 0,
      blocked_until: this.blockedUntil,
      bot_pause_seconds: config.rss.botPauseSeconds,
      cookies: this.cookiesStatus(),
      pot_provider_url: config.ytdlp.potProviderUrl,
      proxy_enabled: Boolean(config.ytdlp.proxy),
      interval_seconds: this.interval,
      max_retries: this.maxRetries,
      retry_base_seconds: this.retryBaseSeconds,
      retry_max_delay_seconds: this.retryMaxDelaySeconds,
      live_recheck_seconds: this.liveRecheckSeconds,
      live_max_age_days: this.liveMaxAgeDays,
      retry_max_age_days: this.retryMaxAgeDays,
      max_retries_per_poll: config.rss.maxRetriesPerPoll,
      ytdlp_concurrent_fragments: config.ytdlp.concurrentFragments,
      ytdlp_retries: config.ytdlp.retries,
      opml_file: this.opmlFile,
      opml_found: Boolean(this.opmlFile && fs.existsSync(this.opmlFile)),
      feed_titles: this.feeds.map((feed) => feed.title),
      last_poll_started: this.lastPollStarted,
      last_poll_finished: this.lastPollFinished,
      last_trigger: this.lastTrigger,
      last_error: this.lastError,
      last_summary: this.lastSummary,
      worker_stats: {},
      counts: this.counts(),
      feeds,
      recent: this.recent.slice(-15),
    };
  }

  summary(): Record<string, unknown> {
    return {
      enabled: this.enabled,
      running: this.running,
      polling: this.running,
      processing: this.running,
      queue: 0,
      blocked_until: this.blockedUntil,
      interval_seconds: this.interval,
      feeds: this.feeds.length,
      last_poll_finished: this.lastPollFinished,
      last_error: this.lastError,
      counts: this.counts(),
    };
  }

  // ------------------------------------------------------------------ control

  trigger(): boolean {
    if (this.running) return false;
    this.lastTrigger = 'manual';
    void this.poll('manual');
    return true;
  }

  triggerBackfill(limit = 10): boolean {
    if (this.running) return false;
    this.lastTrigger = 'backfill';
    void this.poll('backfill', Math.max(1, limit));
    return true;
  }

  resetRetries(): number {
    const now = Math.floor(Date.now() / 1000);
    let reset = 0;
    for (const entry of Object.values(this.state.items)) {
      if (entry.s === 'retry') {
        entry.next = 0;
        entry.t = now;
        reset += 1;
      }
    }
    if (reset) {
      this.blockedUntil = 0;
      this.saveState();
      logger.info(`RSS: Retry-Backoff fuer ${reset} Item(s) zurueckgesetzt.`);
    }
    return reset;
  }

  // ------------------------------------------------------------------ polling

  private async fetchText(url: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'vodarchive-ts/1.0 (+rss)' },
        redirect: 'follow',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }

  private parseItems(feed: RssFeedInfo, xml: string): RssItem[] {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
    });
    const doc = parser.parse(xml) as Record<string, unknown>;
    const rss = doc['rss'] as Record<string, unknown> | undefined;
    const channel = rss?.['channel'] as Record<string, unknown> | undefined;
    const atom = doc['feed'] as Record<string, unknown> | undefined;

    const channelTitle = textOf(channel?.['title']) || textOf(atom?.['title']) || feed.title;
    const rawItems: unknown[] = toArray(channel?.['item'] ?? atom?.['entry']);

    const items: RssItem[] = [];
    for (const raw of rawItems) {
      if (!raw || typeof raw !== 'object') continue;
      const record = raw as Record<string, unknown>;
      const title = textOf(record['title']).trim();
      let url = linkOf(record['link']).trim();
      if (!url) {
        const enclosure = record['enclosure'] as Record<string, unknown> | undefined;
        url = String(enclosure?.['@_url'] ?? '').trim();
      }
      if (!url) {
        const media = record['media:content'] as Record<string, unknown> | undefined;
        url = String(media?.['@_url'] ?? '').trim();
      }
      if (!url) continue;

      const published =
        parseDate(record['pubDate']) ??
        parseDate(record['published']) ??
        parseDate(record['updated']) ??
        null;

      const media = record['media:content'] as Record<string, unknown> | undefined;
      const thumbnail =
        String(media?.['@_url'] ?? '').trim() ||
        String((record['media:thumbnail'] as Record<string, unknown> | undefined)?.['@_url'] ?? '').trim() ||
        null;

      const key = makeItemKey(url);
      items.push({
        key,
        channel: channelTitle,
        title: title || url,
        url,
        published,
        thumbnail,
        platform: platformFromHost(url),
        recordingId: `rss-${key.slice(0, 10)}`,
        publishedIso: isoDate(published),
      });
    }
    return items;
  }

  private async processItem(item: RssItem): Promise<void> {
    if (!this.onItem) {
      this.state.items[item.key] = { s: 'failed', t: nowSeconds() };
      this.lastError = 'Kein RSS-Upload-Handler registriert.';
      return;
    }
    try {
      await this.onItem(item);
      this.state.items[item.key] = { s: 'archived', t: nowSeconds() };
      this.recent.push(item);
      if (this.recent.length > 50) this.recent = this.recent.slice(-50);
    } catch (error) {
      const message = (error as Error).message;
      this.lastError = message;
      if (this.maxRetries === 0 || (this.state.items[item.key]?.r ?? 0) < this.maxRetries) {
        const attempts = (this.state.items[item.key]?.r ?? 0) + 1;
        const delay = Math.min(
          this.retryMaxDelaySeconds,
          this.retryBaseSeconds * 2 ** (attempts - 1),
        );
        this.state.items[item.key] = {
          s: 'retry',
          t: nowSeconds(),
          next: nowSeconds() + delay,
          r: attempts,
          u: item.url,
          ti: item.title,
          ch: item.channel,
        };
      } else {
        this.state.items[item.key] = { s: 'failed', t: nowSeconds() };
      }
      throw error;
    }
  }

  private async retryDue(): Promise<void> {
    if (!this.onItem || this.maxRetries === 0) return;
    const now = nowSeconds();
    let retried = 0;
    for (const [key, entry] of Object.entries(this.state.items)) {
      if (entry.s !== 'retry' || !entry.u) continue;
      if ((entry.next ?? 0) > now) continue;
      if (retried >= config.rss.maxRetriesPerPoll) break;
      retried += 1;
      const item: RssItem = {
        key,
        channel: entry.ch ?? 'Unbekannt',
        title: entry.ti ?? entry.u,
        url: entry.u,
        published: null,
        thumbnail: null,
        platform: platformFromHost(entry.u),
        recordingId: `rss-${key.slice(0, 10)}`,
        publishedIso: '',
      };
      try {
        await this.processItem(item);
      } catch {
        /* bleibt im Retry-Status */
      }
    }
  }

  private async poll(trigger: 'manual' | 'backfill' | 'interval', backfillLimit?: number): Promise<void> {
    if (this.running || !this.enabled) return;
    this.running = true;
    this.lastPollStarted = nowSeconds();
    this.lastError = null;

    const allowBaseline = !this.state.baseline_done && trigger !== 'backfill' && !this.initialBackfill;
    const limit = trigger === 'backfill' ? backfillLimit ?? this.maxItemsPerPoll : this.maxItemsPerPoll;
    let archived = 0;
    let skipped = 0;
    let failed = 0;

    try {
      if (this.feeds.length === 0) {
        logger.warn('RSS-Poll: keine Feeds konfiguriert (RSS_FEED_URLS/OPML leer).');
      }

      await this.retryDue();

      for (const feed of this.feeds) {
        try {
          const xml = await this.fetchText(feed.url);
          const items = this.parseItems(feed, xml);
          this.state.feeds[feed.url] = { c: nowSeconds(), o: true, n: items.length };

          for (const item of items) {
            if (this.state.items[item.key]) continue;

            if (allowBaseline) {
              this.state.items[item.key] = { s: 'baseline', t: nowSeconds() };
              continue;
            }

            if (item.published) {
              const ageHours = (nowSeconds() - item.published) / 3600;
              if (ageHours > this.maxItemAgeHours) {
                this.state.items[item.key] = { s: 'skipped', t: nowSeconds() };
                skipped += 1;
                continue;
              }
            }

            if (archived >= limit) continue; // spaeteren Poll ueberlassen

            try {
              await this.processItem(item);
              archived += 1;
              logger.info(`RSS: '${item.channel}' – '${item.title}' eingereiht.`);
            } catch {
              failed += 1;
            }
          }
        } catch (error) {
          const message = (error as Error).message;
          this.state.feeds[feed.url] = { ...this.state.feeds[feed.url], c: nowSeconds(), o: false, e: message };
          this.lastError = message;
          logger.warn(`RSS-Feed ${feed.title} fehlgeschlagen: ${message}`);
        }
      }

      if (allowBaseline) this.state.baseline_done = true;
      this.lastSummary = { trigger, archived, skipped, failed, feeds: this.feeds.length };
      logger.info(
        `RSS-Poll abgeschlossen: ${archived} eingereiht, ${skipped} uebersprungen, ${failed} Fehler.`,
      );
    } catch (error) {
      this.lastError = String(error);
      logger.error(`RSS-Poll fehlgeschlagen: ${String(error)}`);
    } finally {
      this.lastPollFinished = nowSeconds();
      this.running = false;
      this.saveState();
    }
  }

  // ------------------------------------------------------------------ lifecycle

  start(): void {
    if (!this.enabled || this.timer) return;
    logger.info(
      `RSS-Archiv aktiviert (Feeds: ${this.feeds.length}, Intervall: ${this.interval}s` +
        `${this.opmlFile ? `, OPML: ${this.opmlFile}` : ''}).`,
    );
    this.timer = setInterval(() => {
      void this.poll('interval');
    }, Math.max(30, this.interval) * 1000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function toArray(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function extractOutlines(node: unknown): Array<Record<string, unknown>> {
  const result: Array<Record<string, unknown>> = [];
  for (const entry of toArray(node)) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    result.push(record);
    if (record['outline']) result.push(...extractOutlines(record['outline']));
  }
  return result;
}

function platformFromHost(url: string): string {
  const host = hostOf(url).toLowerCase();
  if (host.includes('youtube') || host.includes('youtu.be')) return 'youtube';
  if (host.includes('twitch')) return 'twitch';
  if (host.includes('tiktok')) return 'tiktok';
  if (host.includes('instagram')) return 'instagram';
  if (host.includes('twitter') || host === 'x.com') return 'twitter';
  if (host.includes('kick')) return 'kick';
  if (host.includes('rumble')) return 'rumble';
  if (host.includes('odysee')) return 'odysee';
  return 'rss';
}

export const rssArchiver = new RssArchiver();

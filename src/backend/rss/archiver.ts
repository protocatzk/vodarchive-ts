import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { config } from '../config';
import { runProcess } from '../jobs/media';
import { logger } from '../logger';
import { settingsStore } from '../settings/store';
import { sourceStore, type Source } from '../sources/store';
import { fetchStreamrecorder } from '../sources/streamrecorder';

/**
 * RSS-Archiv: liest Quellen aus dem persistenten SourceStore (RSS oder OPML),
 * filtert neue Eintraege und uebergibt sie an die Upload-Pipeline.
 */

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
  /** Zusatzfelder für die Upload-Pipeline (z. B. Streamrecorder). */
  extra?: Record<string, unknown>;
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
  seen_feeds: Record<string, boolean>;
  baseline_done?: boolean;
}

interface FeedRuntime {
  url: string;
  title: string;
  sourceId: string;
  sourceName: string;
  lastCheck: number | null;
  ok: boolean | null;
  error: string | null;
  items: number;
}

interface ItemEntry {
  feedKey: string;
  feedTitle: string;
  items: RssItem[];
}

const EMPTY_STATE: RssState = { feeds: {}, items: {}, seen_feeds: {} };

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

function parseUploadDate(value: unknown): number | null {
  const text = String(value ?? '').trim();
  if (!/^\d{8}$/.test(text)) return null;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  const ms = Date.UTC(year, month - 1, day);
  return Number.isNaN(ms) ? null : ms / 1000;
}

export class RssArchiver {
  onItem: ((item: RssItem) => Promise<void>) | null = null;

  private state: RssState;
  private feedRuntime = new Map<string, FeedRuntime>();
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
  }

  private loadState(): RssState {
    try {
      const raw = fs.readFileSync(config.paths.rssStateFile, 'utf8');
      const parsed = JSON.parse(raw) as Partial<RssState>;
      return {
        feeds: parsed.feeds ?? {},
        items: parsed.items ?? {},
        seen_feeds: parsed.seen_feeds ?? {},
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

  private feedList(): FeedRuntime[] {
    if (this.feedRuntime.size > 0) return Array.from(this.feedRuntime.values());
    // Vor dem ersten Poll: konfigurierte RSS-Quellen als Platzhalter zeigen.
    return sourceStore
      .list()
      .filter((source) => source.type === 'rss')
      .map((source) => ({
        url: source.url,
        title: source.name,
        sourceId: source.id,
        sourceName: source.name,
        lastCheck: source.lastCheck,
        ok: source.lastOk,
        error: source.lastError,
        items: source.lastItems,
      }));
  }

  status(): Record<string, unknown> {
    const settings = settingsStore.get().rss;
    const feeds = this.feedList().map((feed) => ({
      title: feed.title,
      bundle: false,
      child_count: 0,
      host: hostOf(feed.url),
      source_id: feed.sourceId,
      source_name: feed.sourceName,
      last_check: feed.lastCheck,
      ok: feed.ok,
      error: feed.error,
      items: feed.items,
    }));

    return {
      enabled: settings.enabled,
      running: this.running,
      polling: this.running,
      processing: this.running,
      queue: 0,
      blocked_until: this.blockedUntil,
      bot_pause_seconds: config.rss.botPauseSeconds,
      cookies: this.cookiesStatus(),
      pot_provider_url: config.ytdlp.potProviderUrl,
      proxy_enabled: Boolean(config.ytdlp.proxy),
      interval_seconds: settings.pollIntervalSeconds,
      max_retries: settings.maxRetries,
      retry_base_seconds: config.rss.retryBaseSeconds,
      retry_max_delay_seconds: config.rss.retryMaxDelaySeconds,
      live_recheck_seconds: config.rss.liveRecheckSeconds,
      live_max_age_days: config.rss.liveMaxAgeDays,
      retry_max_age_days: config.rss.retryMaxAgeDays,
      max_retries_per_poll: config.rss.maxRetriesPerPoll,
      ytdlp_concurrent_fragments: config.ytdlp.concurrentFragments,
      ytdlp_retries: config.ytdlp.retries,
      opml_file: config.rss.opmlFile,
      opml_found: Boolean(config.rss.opmlFile && fs.existsSync(config.rss.opmlFile)),
      feed_titles: feeds.map((feed) => feed.title),
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
    const settings = settingsStore.get().rss;
    return {
      enabled: settings.enabled,
      running: this.running,
      polling: this.running,
      processing: this.running,
      queue: 0,
      blocked_until: this.blockedUntil,
      interval_seconds: settings.pollIntervalSeconds,
      feeds: this.feedList().length,
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
    void this.poll('backfill', undefined, Math.max(1, limit));
    return true;
  }

  triggerSource(sourceId: string): boolean {
    if (this.running) return false;
    this.lastTrigger = `source:${sourceId}`;
    void this.poll('manual', [sourceId]);
    return true;
  }

  resetRetries(): number {
    const now = nowSeconds();
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

  /** Prueft eine Quelle ohne sie zu speichern (fuer die UI). */
  async preview(
    type: 'rss' | 'opml' | 'ytdlp',
    url: string,
  ): Promise<{ ok: boolean; feeds: number; items: number; error?: string }> {
    try {
      if (type === 'rss') {
        const xml = await this.fetchText(url);
        const items = this.parseItems('preview', xml);
        return { ok: true, feeds: 1, items: items.length };
      }
      if (type === 'ytdlp') {
        const items = await this.discoverYtDlp(url, 'preview');
        return { ok: true, feeds: 1, items: items.length };
      }
      const xml = await this.fetchText(url);
      const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
      const doc = parser.parse(xml) as Record<string, unknown>;
      const body = (doc['opml'] as Record<string, unknown> | undefined)?.['body'];
      const feeds = extractOutlines(body)
        .map((outline) => String(outline['@_xmlUrl'] ?? '').trim())
        .filter(Boolean);
      return { ok: feeds.length > 0, feeds: feeds.length, items: 0 };
    } catch (error) {
      return { ok: false, feeds: 0, items: 0, error: (error as Error).message };
    }
  }

  // ------------------------------------------------------------------ fetching

  private async fetchText(url: string): Promise<string> {
    if (!/^https?:\/\//i.test(url)) {
      return fs.readFileSync(url, 'utf8');
    }
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

  private async expandOpml(source: Source): Promise<Array<{ title: string; url: string }>> {
    const xml = await this.fetchText(source.url);
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const doc = parser.parse(xml) as Record<string, unknown>;
    const body = (doc['opml'] as Record<string, unknown> | undefined)?.['body'];
    const feeds: Array<{ title: string; url: string }> = [];
    const seen = new Set<string>();
    for (const outline of extractOutlines(body)) {
      const url = String(outline['@_xmlUrl'] ?? '').trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      feeds.push({
        title: String(outline['@_title'] ?? outline['@_text'] ?? hostOf(url) ?? url).trim(),
        url,
      });
    }
    if (feeds.length === 0) throw new Error('OPML enthält keine Feeds.');
    return feeds;
  }

  /** Liefert alle Items einer Quelle (RSS: ein Feed, OPML: mehrere, yt-dlp: Discovery). */
  private async collectItems(source: Source): Promise<ItemEntry[]> {
    if (source.type === 'rss') {
      const xml = await this.fetchText(source.url);
      return [
        {
          feedKey: source.url,
          feedTitle: source.name,
          items: this.parseItems(source.name, xml),
        },
      ];
    }
    if (source.type === 'ytdlp') {
      return [
        {
          feedKey: source.url,
          feedTitle: source.name,
          items: await this.discoverYtDlp(source.url, source.name),
        },
      ];
    }
    if (source.type === 'streamrecorder') {
      const result = await fetchStreamrecorder(source);
      const items: RssItem[] = result.items.map((recording) => ({
        key: `sr-${recording.recordingId}`,
        channel: recording.streamer,
        title: recording.title,
        url: recording.url,
        published: recording.published,
        thumbnail: recording.thumbnail,
        platform: recording.platform,
        recordingId: recording.recordingId,
        publishedIso: isoDate(recording.published),
        extra: {
          source: 'streamrecorder',
          use_ytdlp: false,
          download_url: recording.url,
          source_url: recording.url,
          recording_id: recording.recordingId,
          streamer: recording.streamer,
          title: recording.title,
          duration: recording.duration,
          filesize_mb: recording.filesizeMb,
          resolution: recording.resolution,
          thumbnail_url: recording.thumbnail,
          platform: recording.platform,
          category: recording.category,
          max_viewers: recording.maxViewers,
          avg_viewers: recording.avgViewers,
          deletion_time: recording.deletionTime,
          player_url: recording.playerUrl,
          recorded_at: recording.recordedAt,
          cookie: source.cookie ?? '',
          api_base_url: source.apiBaseUrl ?? '',
          target_id: recording.targetId,
          topic_name: source.testMode ? `TEST · ${recording.streamer}` : recording.streamer,
          ...(source.testMode
            ? {
                skip_setdownloaded: true,
                ...(source.testChatId ? { chat_id: source.testChatId } : {}),
                ...(source.testForumChatId
                  ? { forum_chat_id: source.testForumChatId }
                  : {}),
              }
            : {}),
        },
      }));
      return [
        {
          feedKey: `streamrecorder:${source.id}`,
          feedTitle: source.name,
          items,
        },
      ];
    }
    const feeds = await this.expandOpml(source);
    const entries: ItemEntry[] = [];
    for (const feed of feeds) {
      const xml = await this.fetchText(feed.url);
      entries.push({
        feedKey: feed.url,
        feedTitle: feed.title,
        items: this.parseItems(feed.title, xml),
      });
    }
    return entries;
  }

  /** Ermittelt neue Videos eines Kanals/Playlists ohne Download (yt-dlp flat playlist). */
  private async discoverYtDlp(url: string, name: string): Promise<RssItem[]> {
    const settings = settingsStore.get().rss;
    const limit = Math.min(50, Math.max(10, settings.maxItemsPerPoll * 2));
    const args = [
      '--flat-playlist',
      '--dump-json',
      '--no-warnings',
      '--ignore-errors',
      '--playlist-end',
      String(limit),
      ...(config.ytdlp.cookiesFile ? ['--cookies', config.ytdlp.cookiesFile] : []),
      ...(config.ytdlp.proxy ? ['--proxy', config.ytdlp.proxy] : []),
      url,
    ];

    let output = '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      await runProcess(config.media.ytdlpPath, args, {
        signal: controller.signal,
        onStdout: (line) => {
          output += `${line}\n`;
        },
      });
    } finally {
      clearTimeout(timer);
    }

    const items: RssItem[] = [];
    for (const line of output.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const id = String(data['id'] ?? '').trim();
      const webpage = String(data['webpage_url'] ?? '').trim();
      const fallback = id ? `https://www.youtube.com/watch?v=${id}` : '';
      const videoUrl = webpage || String(data['url'] ?? '').trim() || fallback;
      if (!videoUrl) continue;

      const publishedRaw = data['timestamp'] ?? data['release_timestamp'];
      const published =
        typeof publishedRaw === 'number' ? publishedRaw : parseUploadDate(data['upload_date']);
      const thumbs = Array.isArray(data['thumbnails'])
        ? (data['thumbnails'] as Array<Record<string, unknown>>)
        : [];
      const lastThumb = thumbs.length ? String(thumbs[thumbs.length - 1]?.['url'] ?? '') : '';
      const thumbnail = String(data['thumbnail'] ?? '').trim() || lastThumb || null;
      const key = makeItemKey(videoUrl);

      items.push({
        key,
        channel: String(data['channel'] ?? data['uploader'] ?? name),
        title: String(data['title'] ?? videoUrl),
        url: videoUrl,
        published,
        thumbnail,
        platform: platformFromHost(videoUrl),
        recordingId: `yt-${id || key.slice(0, 10)}`,
        publishedIso: isoDate(published),
      });
    }
    return items;
  }

  private parseItems(feedTitle: string, xml: string): RssItem[] {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
    });
    const doc = parser.parse(xml) as Record<string, unknown>;
    const rss = doc['rss'] as Record<string, unknown> | undefined;
    const channel = rss?.['channel'] as Record<string, unknown> | undefined;
    const atom = doc['feed'] as Record<string, unknown> | undefined;

    const channelTitle = textOf(channel?.['title']) || textOf(atom?.['title']) || feedTitle;
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
        String(
          (record['media:thumbnail'] as Record<string, unknown> | undefined)?.['@_url'] ?? '',
        ).trim() ||
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
      const maxRetries = settingsStore.get().rss.maxRetries;
      if (maxRetries === 0 || (this.state.items[item.key]?.r ?? 0) < maxRetries) {
        const attempts = (this.state.items[item.key]?.r ?? 0) + 1;
        const delay = Math.min(
          config.rss.retryMaxDelaySeconds,
          config.rss.retryBaseSeconds * 2 ** (attempts - 1),
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
    const settings = settingsStore.get().rss;
    if (!this.onItem || settings.maxRetries === 0) return;
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

  private isDue(source: Source, now: number, defaultInterval: number): boolean {
    const interval = source.pollIntervalSeconds ?? defaultInterval;
    if (source.lastCheck === null) return true;
    return source.lastCheck + interval <= now;
  }

  private recordFeed(
    feed: { title: string; url: string },
    source: Source,
    data: { ok: boolean; error: string | null; items: number; at: number },
  ): void {
    this.feedRuntime.set(feed.url, {
      url: feed.url,
      title: feed.title,
      sourceId: source.id,
      sourceName: source.name,
      lastCheck: data.at,
      ok: data.ok,
      error: data.error,
      items: data.items,
    });
  }

  private async poll(
    trigger: 'manual' | 'backfill' | 'interval',
    sourceIds?: string[],
    backfillLimit?: number,
  ): Promise<void> {
    const settings = settingsStore.get().rss;
    if (this.running || !settings.enabled) return;

    const allSources = sourceStore.listEnabled();
    const candidates = sourceIds
      ? allSources.filter((source) => sourceIds.includes(source.id))
      : allSources;
    const now = nowSeconds();
    const selected =
      trigger === 'interval'
        ? candidates.filter((source) =>
            this.isDue(source, now, settings.pollIntervalSeconds),
          )
        : candidates;

    if (selected.length === 0) return;

    this.running = true;
    this.lastPollStarted = now;
    this.lastError = null;

    const limit =
      trigger === 'backfill' ? backfillLimit ?? settings.maxItemsPerPoll : settings.maxItemsPerPoll;
    let archived = 0;
    let skipped = 0;
    let failed = 0;

    try {
      await this.retryDue();

      for (const source of selected) {
        try {
          if (source.type === 'streamrecorder' && source.dryRun) {
            const result = await fetchStreamrecorder(source);
            const at = nowSeconds();
            this.recordFeed(
              { title: source.name, url: source.url },
              source,
              { ok: true, error: null, items: result.items.length, at },
            );
            sourceStore.markChecked(source.id, { ok: true, items: result.items.length });
            logger.info(
              `Testlauf '${source.name}': ${result.items.length} Kandidat(en), kein Upload.`,
            );
            for (const item of result.items.slice(0, 20)) {
              logger.info(
                `  ${item.streamer} · ${item.title} · ${item.recordingId} · ${item.platform}`,
              );
            }
            continue;
          }

          const entries = await this.collectItems(source);
          const backfill = source.initialBackfill ?? settings.initialBackfill;
          let sourceItems = 0;
          for (const entry of entries) {
            sourceItems += entry.items.length;
            const firstSeen = !this.state.seen_feeds[entry.feedKey];
            const at = nowSeconds();
            this.recordFeed(
              { title: entry.feedTitle, url: entry.feedKey },
              source,
              { ok: true, error: null, items: entry.items.length, at },
            );

            for (const item of entry.items) {
              if (this.state.items[item.key]) continue;

              if (firstSeen && trigger !== 'backfill' && !backfill) {
                this.state.items[item.key] = { s: 'baseline', t: at };
                continue;
              }

              if (item.published) {
                const ageHours = (nowSeconds() - item.published) / 3600;
                if (ageHours > settings.maxItemAgeHours) {
                  this.state.items[item.key] = { s: 'skipped', t: at };
                  skipped += 1;
                  continue;
                }
              }

              if (archived >= limit) continue;

              const archivedAsRss = await this.enqueue(item);
              if (archivedAsRss) {
                archived += 1;
                sourceStore.incrementArchived(source.id);
                logger.info(`Quelle '${source.name}': '${item.channel}' – '${item.title}' eingereiht.`);
              } else {
                failed += 1;
              }
            }

            if (firstSeen) this.state.seen_feeds[entry.feedKey] = true;
          }
          sourceStore.markChecked(source.id, { ok: true, items: sourceItems });
        } catch (error) {
          const message = (error as Error).message;
          sourceStore.markChecked(source.id, { ok: false, error: message });
          this.feedRuntime.set(`source:${source.id}`, {
            url: source.url,
            title: source.name,
            sourceId: source.id,
            sourceName: source.name,
            lastCheck: nowSeconds(),
            ok: false,
            error: message,
            items: 0,
          });
          this.lastError = message;
          logger.warn(`RSS-Quelle '${source.name}' fehlgeschlagen: ${message}`);
        }
      }

      this.lastSummary = {
        trigger,
        sources: selected.length,
        archived,
        skipped,
        failed,
      };
      logger.info(
        `RSS-Poll abgeschlossen: ${archived} eingereiht, ${skipped} uebersprungen, ${failed} Fehler (${selected.length} Quelle(n)).`,
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

  private async enqueue(item: RssItem): Promise<boolean> {
    try {
      await this.processItem(item);
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------ lifecycle

  start(): void {
    if (this.timer) return;
    logger.info(
      `RSS-Archiv aktiv (Quellen: ${sourceStore.listEnabled().length}, Tick: 30s, ` +
        `Intervall: ${settingsStore.get().rss.pollIntervalSeconds}s).`,
    );
    this.timer = setInterval(() => {
      void this.poll('interval');
    }, 30000);
    this.timer.unref?.();
    const initial = setTimeout(() => void this.poll('interval'), 4000);
    initial.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export const rssArchiver = new RssArchiver();

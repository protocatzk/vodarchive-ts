import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { logger } from '../logger';

/**
 * RSS-Archiv (rss.app) – TypeScript-Gerüst.
 *
 * Die komplette Feed-Verarbeitung (RSS parsen, yt-dlp, Telegram-Upload) ist
 * noch nicht portiert. Status-/Trigger-API und Zustandsverwaltung entsprechen
 * aber bereits dem Python-Original, damit Dashboard und n8n weiterlaufen.
 */

export interface RssFeedInfo {
  title: string;
  url: string;
  source_url: string | null;
  bundle: boolean;
  child_count: number;
}

export type RssItemStatus = 'archived' | 'skipped' | 'failed' | 'retry' | 'live' | 'baseline';

export interface RssItemEntry {
  s: RssItemStatus;
  t: number;
  next?: number;
}

interface RssState {
  feeds: Record<string, { c?: number; o?: boolean; e?: string; n?: number }>;
  items: Record<string, RssItemEntry>;
}

const EMPTY_STATE: RssState = { feeds: {}, items: {} };

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

export class RssArchiver {
  readonly enabled = config.rss.enabled;
  private readonly opmlFile = config.rss.opmlFile;
  private readonly feedTitles = config.rss.feedTitles;
  private readonly interval = config.rss.pollIntervalSeconds;
  private readonly maxRetries = config.rss.maxRetries;
  private readonly retryBaseSeconds = config.rss.retryBaseSeconds;
  private readonly retryMaxDelaySeconds = config.rss.retryMaxDelaySeconds;
  private readonly liveRecheckSeconds = config.rss.liveRecheckSeconds;
  private readonly liveMaxAgeDays = config.rss.liveMaxAgeDays;
  private readonly retryMaxAgeDays = config.rss.retryMaxAgeDays;
  private readonly maxRetriesPerPoll = config.rss.maxRetriesPerPoll;
  private readonly botPauseSeconds = config.rss.botPauseSeconds;
  private readonly potProviderUrl = config.ytdlp.potProviderUrl;
  private readonly proxy = config.ytdlp.proxy;

  private readonly feeds: RssFeedInfo[];
  private state: RssState;
  private reading = false;
  private workerBusy = false;
  private blockedUntil = 0;
  private timer: NodeJS.Timeout | null = null;

  lastPollStarted: number | null = null;
  lastPollFinished: number | null = null;
  lastTrigger: string | null = null;
  lastError: string | null = null;
  lastSummary: unknown = null;
  recent: unknown[] = [];

  constructor() {
    this.feeds = config.rss.feedUrls.map((url, index) => ({
      title: this.feedTitles[index] ?? hostOf(url) ?? `Feed ${index + 1}`,
      url,
      source_url: null,
      bundle: false,
      child_count: 0,
    }));
    this.state = this.loadState();
  }

  private loadState(): RssState {
    try {
      const raw = fs.readFileSync(config.paths.rssStateFile, 'utf8');
      const parsed = JSON.parse(raw) as Partial<RssState>;
      return {
        feeds: parsed.feeds ?? {},
        items: parsed.items ?? {},
      };
    } catch {
      return structuredClone(EMPTY_STATE);
    }
  }

  private saveState(): void {
    try {
      fs.mkdirSync(path.dirname(config.paths.rssStateFile), { recursive: true });
      fs.writeFileSync(
        config.paths.rssStateFile,
        JSON.stringify(this.state, null, 1),
        'utf8',
      );
    } catch (error) {
      logger.warn(`RSS-State konnte nicht geschrieben werden: ${String(error)}`);
    }
  }

  private counts(): Record<string, number> {
    const counts = {
      archived: 0,
      skipped: 0,
      failed: 0,
      retry: 0,
      live: 0,
      baseline: 0,
    };
    for (const entry of Object.values(this.state.items)) {
      const status = entry.s;
      if (status in counts) counts[status] += 1;
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
      running: this.reading || this.workerBusy,
      polling: this.reading,
      processing: this.workerBusy,
      queue: 0,
      blocked_until: this.blockedUntil,
      bot_pause_seconds: this.botPauseSeconds,
      cookies: this.cookiesStatus(),
      pot_provider_url: this.potProviderUrl,
      proxy_enabled: Boolean(this.proxy),
      interval_seconds: this.interval,
      max_retries: this.maxRetries,
      retry_base_seconds: this.retryBaseSeconds,
      retry_max_delay_seconds: this.retryMaxDelaySeconds,
      live_recheck_seconds: this.liveRecheckSeconds,
      live_max_age_days: this.liveMaxAgeDays,
      retry_max_age_days: this.retryMaxAgeDays,
      max_retries_per_poll: this.maxRetriesPerPoll,
      ytdlp_concurrent_fragments: config.ytdlp.concurrentFragments,
      ytdlp_retries: config.ytdlp.retries,
      opml_file: this.opmlFile,
      opml_found: Boolean(this.opmlFile && fs.existsSync(this.opmlFile)),
      feed_titles: this.feedTitles,
      last_poll_started: this.lastPollStarted,
      last_poll_finished: this.lastPollFinished,
      last_trigger: this.lastTrigger,
      last_error: this.lastError,
      last_summary: this.lastSummary,
      worker_stats: {},
      counts: this.counts(),
      feeds,
      recent: [...this.recent].slice(-15),
    };
  }

  summary(): Record<string, unknown> {
    return {
      enabled: this.enabled,
      running: this.reading || this.workerBusy,
      polling: this.reading,
      processing: this.workerBusy,
      queue: 0,
      blocked_until: this.blockedUntil,
      interval_seconds: this.interval,
      feeds: this.feeds.length,
      last_poll_finished: this.lastPollFinished,
      last_error: this.lastError,
      counts: this.counts(),
    };
  }

  trigger(): boolean {
    if (this.reading) return false;
    this.reading = true;
    this.lastTrigger = 'manual';
    void this.poll('manual');
    return true;
  }

  triggerBackfill(limit = 10): boolean {
    if (this.reading) return false;
    this.reading = true;
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

  private async poll(trigger: 'manual' | 'backfill' | 'interval', backfillLimit?: number): Promise<void> {
    this.lastPollStarted = Date.now() / 1000;
    this.lastError = null;
    try {
      logger.info(
        `RSS-Poll (${trigger}${backfillLimit ? `, limit=${backfillLimit}` : ''}) gestartet – ` +
          'Feed-Verarbeitung ist im TypeScript-Rewrite noch nicht implementiert.',
      );
      this.lastSummary = {
        trigger,
        feeds: this.feeds.length,
        note: 'not-implemented-yet',
      };
    } catch (error) {
      this.lastError = String(error);
      logger.error(`RSS-Poll fehlgeschlagen: ${String(error)}`);
    } finally {
      this.lastPollFinished = Date.now() / 1000;
      this.reading = false;
    }
  }

  start(): void {
    if (!this.enabled || this.timer) return;
    logger.info(
      `RSS-Archiv aktiviert (Feeds: ${this.feeds.length}, Intervall: ${this.interval}s). ` +
        'Hinweis: Feed-Verarbeitung noch nicht portiert.',
    );
    this.timer = setInterval(() => {
      if (!this.reading) void this.poll('interval');
    }, Math.max(30, this.interval) * 1000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export const rssArchiver = new RssArchiver();

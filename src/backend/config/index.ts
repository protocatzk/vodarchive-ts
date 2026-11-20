import path from 'node:path';
import dotenv from 'dotenv';

// Lade .env aus dem Arbeitsverzeichnis (wie im Python-Original via find_dotenv(usecwd=True)).
dotenv.config();

function envStr(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined ? fallback : value.trim();
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function envList(name: string): string[] {
  return envStr(name)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const cwd = process.cwd();
const dataDir = path.resolve(cwd, envStr('DATA_DIR', 'data'));

function dataPath(envName: string, filename: string): string {
  const explicit = envStr(envName);
  return explicit ? path.resolve(cwd, explicit) : path.join(dataDir, filename);
}

export const config = {
  isProduction: envStr('NODE_ENV', 'development') === 'production',
  port: envInt('PORT', 8080),

  paths: {
    baseDir: dataDir,
    topicsCacheFile: dataPath('TOPICS_CACHE_FILE', 'topics_cache.json'),
    rssStateFile: dataPath('RSS_STATE_FILE', 'rss_state.json'),
    telegramSessionFile: dataPath('TELEGRAM_SESSION_FILE', 'telegram.session'),
  },

  media: {
    ytdlpPath: envStr('YTDLP_PATH', 'yt-dlp'),
    ffmpegPath: envStr('FFMPEG_PATH', 'ffmpeg'),
    ffprobePath: envStr('FFPROBE_PATH', 'ffprobe'),
  },

  telegram: {
    apiId: envInt('TELEGRAM_API_ID', 0),
    apiHash: envStr('TELEGRAM_API_HASH'),
    botToken: envStr('TELEGRAM_BOT_TOKEN'),
    defaultChatId: envStr('TELEGRAM_CHAT_ID'),
    defaultForumChatId: envStr('TELEGRAM_FORUM_CHAT_ID'),
    forwardDropAuthor: envBool('FORWARD_DROP_AUTHOR', true),
    allowedDashboardUsers: envList('ALLOWED_DASHBOARD_USERS').map((u) => u.toLowerCase()),
  },

  upload: {
    splitThresholdBytes: Math.round(1.8 * 1024 * 1024 * 1024),
    targetPartSizeBytes: Math.round(1.4 * 1024 * 1024 * 1024),
    parallelWorkers: envInt('PARALLEL_UPLOAD_WORKERS', 3),
    ffmpegThreads: envInt('FFMPEG_THREADS', 2),
    downloadInactivityTimeout: envInt('DOWNLOAD_INACTIVITY_TIMEOUT', 120),
    downloadChunkSize: Math.max(64 * 1024, envInt('DOWNLOAD_CHUNK_SIZE', 1024 * 1024)),
    keepFiles: envBool('KEEP_JOB_FILES', false),
  },

  auth: {
    // Wenn true, wird der Telegram-Login uebersprungen (nur fuer lokale Entwicklung!).
    devMode: envBool('AUTH_DEV_MODE', false),
    devUser: envStr('AUTH_DEV_USER', '@dev'),
    sessionTtlSeconds: envInt('AUTH_SESSION_TTL_SECONDS', 86400 * 30),
    pendingTokenTtlSeconds: 600,
  },

  jobs: {
    doneTtlDays: envInt('JOB_DONE_TTL_DAYS', 14),
    staleDays: envInt('JOB_STALE_DAYS', 3),
    failedTtlDays: envInt('JOB_FAILED_TTL_DAYS', 30),
    simulate: envBool('SIMULATE_JOBS', true),
  },

  rss: {
    enabled: envBool('RSS_ENABLED', true),
    opmlFile: envStr('RSS_OPML_FILE', 'rss-app-opml.xml'),
    feedUrls: envList('RSS_FEED_URLS'),
    feedTitles: envList('RSS_FEED_TITLES'),
    pollIntervalSeconds: envInt('RSS_POLL_INTERVAL_SECONDS', 900),
    initialBackfill: envBool('RSS_INITIAL_BACKFILL', false),
    maxItemAgeHours: envInt('RSS_MAX_ITEM_AGE_HOURS', 48),
    maxItemsPerPoll: envInt('RSS_MAX_ITEMS_PER_POLL', 10),
    retentionDays: envInt('RSS_STATE_RETENTION_DAYS', 90),
    allowLive: envBool('RSS_ALLOW_LIVE', false),
    topicPerFeed: envBool('RSS_TOPIC_PER_FEED', true),
    archiveChatId: envStr('RSS_ARCHIVE_CHAT_ID'),
    archiveForumChatId: envStr('RSS_ARCHIVE_FORUM_CHAT_ID'),
    maxRetries: envInt('RSS_MAX_RETRIES', 0),
    retryBaseSeconds: envInt('RSS_RETRY_BASE_SECONDS', 900),
    retryMaxDelaySeconds: envInt('RSS_RETRY_MAX_DELAY_SECONDS', 21600),
    liveRecheckSeconds: envInt('RSS_LIVE_RECHECK_SECONDS', 900),
    botPauseSeconds: envInt('RSS_BOT_PAUSE_SECONDS', 3600),
    liveMaxAgeDays: envInt('RSS_LIVE_MAX_AGE_DAYS', 7),
    retryMaxAgeDays: envInt('RSS_RETRY_MAX_AGE_DAYS', 30),
    maxRetriesPerPoll: envInt('RSS_MAX_RETRIES_PER_POLL', 3),
  },

  ytdlp: {
    cookiesFile: envStr('YTDLP_COOKIES_FILE'),
    potProviderUrl: envStr('YTDLP_POT_PROVIDER_URL', 'http://bgutil-provider:4416'),
    proxy: envStr('YTDLP_PROXY'),
    concurrentFragments: envInt('YTDLP_CONCURRENT_FRAGMENTS', 4),
    retries: envInt('YTDLP_RETRIES', 10),
    httpChunkSize: envStr('YTDLP_HTTP_CHUNK_SIZE'),
    format: envStr('YTDLP_FORMAT'),
  },

  n8n: {
    webhooks: parseWebhooks(envStr('N8N_WEBHOOKS_JSON')),
    timeoutSeconds: envInt('N8N_WEBHOOK_TIMEOUT', 20),
    triggerCooldownSeconds: envInt('N8N_TRIGGER_COOLDOWN', 60),
  },
} as const;

export type AppConfig = typeof config;

function parseWebhooks(raw: string): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) result[key] = value.trim();
    }
    return result;
  } catch {
    return {};
  }
}

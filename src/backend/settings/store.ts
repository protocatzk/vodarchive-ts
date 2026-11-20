import { config } from '../config';
import { logger } from '../logger';
import { deepMerge, readJsonFile, writeJsonFileAtomic } from '../util/json';
import path from 'node:path';

export interface AppSettings {
  telegram: {
    apiId: number;
    apiHash: string;
    botToken: string;
    chatId: string;
    forumChatId: string;
    forwardDropAuthor: boolean;
    allowedDashboardUsers: string[];
  };
  jobs: {
    simulate: boolean;
    parallelWorkers: number;
    keepFiles: boolean;
    doneTtlDays: number;
    staleDays: number;
    failedTtlDays: number;
  };
  upload: {
    splitThresholdBytes: number;
    targetPartSizeBytes: number;
  };
  rss: {
    enabled: boolean;
    pollIntervalSeconds: number;
    initialBackfill: boolean;
    maxItemAgeHours: number;
    maxItemsPerPoll: number;
    allowLive: boolean;
    topicPerFeed: boolean;
    archiveChatId: string;
    archiveForumChatId: string;
    maxRetries: number;
  };
  n8n: {
    timeoutSeconds: number;
    triggerCooldownSeconds: number;
    apiBaseUrl: string;
    apiKey: string;
  };
}

export interface MaskedSettings extends AppSettings {
  secrets: {
    telegramApiHash: boolean;
    telegramBotToken: boolean;
    n8nApiKey: boolean;
  };
}

const SECRET_PATHS: Array<[keyof AppSettings, string]> = [
  ['telegram', 'apiHash'],
  ['telegram', 'botToken'],
  ['n8n', 'apiKey'],
];

export function defaultSettings(): AppSettings {
  return {
    telegram: {
      apiId: config.telegram.apiId,
      apiHash: config.telegram.apiHash,
      botToken: config.telegram.botToken,
      chatId: config.telegram.defaultChatId,
      forumChatId: config.telegram.defaultForumChatId,
      forwardDropAuthor: config.telegram.forwardDropAuthor,
      allowedDashboardUsers: [...config.telegram.allowedDashboardUsers],
    },
    jobs: {
      simulate: config.jobs.simulate,
      parallelWorkers: config.upload.parallelWorkers,
      keepFiles: config.upload.keepFiles,
      doneTtlDays: config.jobs.doneTtlDays,
      staleDays: config.jobs.staleDays,
      failedTtlDays: config.jobs.failedTtlDays,
    },
    upload: {
      splitThresholdBytes: config.upload.splitThresholdBytes,
      targetPartSizeBytes: config.upload.targetPartSizeBytes,
    },
    rss: {
      enabled: config.rss.enabled,
      pollIntervalSeconds: config.rss.pollIntervalSeconds,
      initialBackfill: config.rss.initialBackfill,
      maxItemAgeHours: config.rss.maxItemAgeHours,
      maxItemsPerPoll: config.rss.maxItemsPerPoll,
      allowLive: config.rss.allowLive,
      topicPerFeed: config.rss.topicPerFeed,
      archiveChatId: config.rss.archiveChatId,
      archiveForumChatId: config.rss.archiveForumChatId,
      maxRetries: config.rss.maxRetries,
    },
    n8n: {
      timeoutSeconds: config.n8n.timeoutSeconds,
      triggerCooldownSeconds: config.n8n.triggerCooldownSeconds,
      apiBaseUrl: '',
      apiKey: '',
    },
  };
}

export class SettingsStore {
  readonly file: string;
  private data: AppSettings;

  constructor(file = path.join(config.paths.baseDir, 'settings.json')) {
    this.file = file;
    const stored = readJsonFile<Partial<AppSettings>>(file, {});
    this.data = sanitize(deepMerge(defaultSettings(), stored));
    if (Object.keys(stored).length === 0) this.persist();
  }

  get(): AppSettings {
    return this.data;
  }

  getMasked(): MaskedSettings {
    const clone = structuredClone(this.data);
    const secrets = {
      telegramApiHash: Boolean(clone.telegram.apiHash),
      telegramBotToken: Boolean(clone.telegram.botToken),
      n8nApiKey: Boolean(clone.n8n.apiKey),
    };
    clone.telegram.apiHash = '';
    clone.telegram.botToken = '';
    clone.n8n.apiKey = '';
    return { ...clone, secrets };
  }

  update(patch: unknown): { settings: AppSettings; restartRequired: boolean } {
    const cleanPatch = sanitizePatch(patch);
    const before = structuredClone(this.data);
    const merged = sanitize(deepMerge(before, cleanPatch));
    this.data = merged;
    this.persist();
    const restartRequired =
      before.telegram.apiId !== merged.telegram.apiId ||
      before.telegram.apiHash !== merged.telegram.apiHash ||
      before.telegram.botToken !== merged.telegram.botToken;
    return { settings: merged, restartRequired };
  }

  private persist(): void {
    try {
      writeJsonFileAtomic(this.file, this.data, 0o600);
    } catch (error) {
      logger.warn(`Settings konnten nicht gespeichert werden: ${String(error)}`);
    }
  }
}

function sanitizePatch(patch: unknown): Record<string, unknown> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('JSON-Objekt erwartet.');
  }
  const clone = structuredClone(patch) as Record<string, unknown>;
  for (const [group, key] of SECRET_PATHS) {
    const groupObj = clone[group] as Record<string, unknown> | undefined;
    if (!groupObj || typeof groupObj !== 'object') continue;
    const value = groupObj[key];
    if (value === undefined || value === '') {
      delete groupObj[key];
    } else if (value === null) {
      groupObj[key] = '';
    }
  }
  return clone;
}

function toInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function toBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  return fallback;
}

function toStr(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function toList(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  }
  return fallback;
}

function sanitize(input: AppSettings): AppSettings {
  const s = structuredClone(input);
  s.telegram.apiId = toInt(s.telegram.apiId, 0, 0, Number.MAX_SAFE_INTEGER);
  s.telegram.apiHash = toStr(s.telegram.apiHash);
  s.telegram.botToken = toStr(s.telegram.botToken);
  s.telegram.chatId = toStr(s.telegram.chatId);
  s.telegram.forumChatId = toStr(s.telegram.forumChatId);
  s.telegram.forwardDropAuthor = toBool(s.telegram.forwardDropAuthor, true);
  s.telegram.allowedDashboardUsers = toList(s.telegram.allowedDashboardUsers, []);

  s.jobs.simulate = toBool(s.jobs.simulate, false);
  s.jobs.parallelWorkers = toInt(s.jobs.parallelWorkers, 3, 1, 16);
  s.jobs.keepFiles = toBool(s.jobs.keepFiles, false);
  s.jobs.doneTtlDays = toInt(s.jobs.doneTtlDays, 14, 1, 3650);
  s.jobs.staleDays = toInt(s.jobs.staleDays, 3, 1, 3650);
  s.jobs.failedTtlDays = toInt(s.jobs.failedTtlDays, 30, 1, 3650);

  s.upload.splitThresholdBytes = toInt(
    s.upload.splitThresholdBytes,
    config.upload.splitThresholdBytes,
    100 * 1024 * 1024,
    4 * 1024 ** 3,
  );
  s.upload.targetPartSizeBytes = toInt(
    s.upload.targetPartSizeBytes,
    config.upload.targetPartSizeBytes,
    50 * 1024 * 1024,
    s.upload.splitThresholdBytes,
  );

  s.rss.enabled = toBool(s.rss.enabled, true);
  s.rss.pollIntervalSeconds = toInt(s.rss.pollIntervalSeconds, 900, 60, 86400);
  s.rss.initialBackfill = toBool(s.rss.initialBackfill, false);
  s.rss.maxItemAgeHours = toInt(s.rss.maxItemAgeHours, 48, 1, 24 * 365);
  s.rss.maxItemsPerPoll = toInt(s.rss.maxItemsPerPoll, 10, 1, 100);
  s.rss.allowLive = toBool(s.rss.allowLive, false);
  s.rss.topicPerFeed = toBool(s.rss.topicPerFeed, true);
  s.rss.archiveChatId = toStr(s.rss.archiveChatId);
  s.rss.archiveForumChatId = toStr(s.rss.archiveForumChatId);
  s.rss.maxRetries = toInt(s.rss.maxRetries, 0, 0, 100);

  s.n8n.timeoutSeconds = toInt(s.n8n.timeoutSeconds, 20, 1, 300);
  s.n8n.triggerCooldownSeconds = toInt(s.n8n.triggerCooldownSeconds, 60, 0, 86400);
  s.n8n.apiBaseUrl = toStr(s.n8n.apiBaseUrl).replace(/\/+$/, '');
  s.n8n.apiKey = toStr(s.n8n.apiKey);

  return s;
}

export const settingsStore = new SettingsStore();

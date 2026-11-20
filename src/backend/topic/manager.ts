import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger';
import type { TelegramGateway } from '../telegram/gateway';

/**
 * Verwaltet die Alias -> Topic-ID-Zuordnung (persistenter JSON-Cache) und
 * bietet Smart-Matching sowie das Anlegen/Weiterleiten von Telegram-Topics.
 */

export type TopicCache = Record<string, Record<string, number>>;

export const TOPICS_CACHE_FILE = path.resolve(
  process.cwd(),
  process.env['TOPICS_CACHE_FILE'] || 'data/topics_cache.json',
);

// rss.app haengt Plattform-Suffixe an Feed-Titel, z. B. "MontanaBlack - YouTube".
const PLATFORM_SUFFIX_RE = new RegExp(
  String.raw`\s*(?:[-–—|/]\s*(?:youtube|twitter|x|tiktok|instagram|facebook|twitch|odysee|rumble|vimeo|kick|reddit)(?:\s*\([^)]*\))?)\s*$`,
  'i',
);

export function stripPlatformSuffix(text: string): string {
  const cleaned = String(text ?? '')
    .replace(PLATFORM_SUFFIX_RE, '')
    .trim();
  return cleaned || String(text ?? '').trim();
}

export function normalizeKey(text: string): string {
  return String(text ?? '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function matchTitles(title: string): string[] {
  const titles: string[] = [];
  for (const candidate of [title.trim(), stripPlatformSuffix(title)]) {
    if (candidate && !titles.includes(candidate)) titles.push(candidate);
  }
  return titles;
}

export function coerceChatReference(value: unknown): number | string {
  const text = String(value ?? '').trim();
  if (/^-?\d+$/.test(text)) {
    const parsed = Number.parseInt(text, 10);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return value as number | string;
}

export class TopicManager {
  readonly cacheFile: string;
  cache: TopicCache = {};

  constructor(cacheFile: string = TOPICS_CACHE_FILE) {
    this.cacheFile = cacheFile;
    this.loadCache();
  }

  loadCache(): void {
    if (!fs.existsSync(this.cacheFile)) {
      this.cache = {};
      return;
    }
    try {
      const content = fs.readFileSync(this.cacheFile, 'utf8').trim();
      this.cache = content ? (JSON.parse(content) as TopicCache) : {};
      const total = Object.values(this.cache).reduce(
        (sum, value) => sum + (value && typeof value === 'object' ? Object.keys(value).length : 0),
        0,
      );
      logger.info(`Topic-Cache aus '${this.cacheFile}' geladen: ${total} Topics bekannt.`);
    } catch (error) {
      logger.warn(`Konnte Topic-Cache ${this.cacheFile} nicht lesen: ${String(error)}`);
      this.cache = {};
    }
  }

  private saveCache(): void {
    try {
      fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true });
      const tmpFile = `${this.cacheFile}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(this.cache, null, 2), 'utf8');
      try {
        fs.renameSync(tmpFile, this.cacheFile);
      } catch {
        // Docker bind mount fallback: Inode cannot be replaced, copy in-place.
        fs.copyFileSync(tmpFile, this.cacheFile);
        fs.rmSync(tmpFile, { force: true });
      }
    } catch (error) {
      logger.warn(`Konnte Topic-Cache ${this.cacheFile} nicht schreiben: ${String(error)}`);
    }
  }

  findCachedTopic(chatKey: string, title: string): number | null {
    const topicsDict = this.cache[String(chatKey)];
    if (!topicsDict || typeof topicsDict !== 'object') return null;

    const candidates = matchTitles(title);
    if (!candidates.length) return null;

    // 1. Exakter Match (case-insensitive)
    for (const candidate of candidates) {
      for (const [name, tid] of Object.entries(topicsDict)) {
        if (name.trim().toLowerCase() === candidate.toLowerCase()) {
          logger.info(`Exakter Topic-Match gefunden: '${title}' -> '${name}' (ID: ${tid})`);
          return tid;
        }
      }
    }

    // 2. Bereinigter alphanumerischer Match
    for (const candidate of candidates) {
      const normInput = normalizeKey(candidate);
      if (!normInput) continue;
      for (const [name, tid] of Object.entries(topicsDict)) {
        if (normalizeKey(name) === normInput) {
          logger.info(`Normalisierter Topic-Match gefunden: '${title}' -> '${name}' (ID: ${tid})`);
          return tid;
        }
      }
    }

    // 3. Praefix- und Substring-Match
    let best: { score: number; name: string; tid: number; kind: string } | null = null;
    for (const candidate of candidates) {
      const normInput = normalizeKey(candidate);
      if (normInput.length < 4) continue;
      for (const [name, tid] of Object.entries(topicsDict)) {
        const normCached = normalizeKey(name);
        if (normCached.length < 4) continue;
        if (normInput.startsWith(normCached) || normCached.startsWith(normInput)) {
          const score = Math.min(normCached.length, normInput.length);
          if (!best || score > best.score) best = { score, name, tid, kind: 'Praefix' };
        } else if (normCached.includes(normInput) || normInput.includes(normCached)) {
          const score = Math.min(normCached.length, normInput.length);
          if (!best || score > best.score) best = { score, name, tid, kind: 'Substring' };
        }
      }
    }

    if (best) {
      const match = best as { score: number; name: string; tid: number; kind: string };
      logger.info(
        `${match.kind}-Topic-Match gefunden: '${title}' <-> '${match.name}' (ID: ${match.tid}, Score: ${match.score})`,
      );
      return match.tid;
    }

    return null;
  }

  // ---------------------------------------------------------------- Cache-Verwaltung

  private chatDict(chatKey: string): Record<string, number> {
    const key = String(chatKey);
    const existing = this.cache[key];
    if (existing && typeof existing === 'object') return existing;
    const created: Record<string, number> = {};
    this.cache[key] = created;
    return created;
  }

  listTopics(chatKey: string): Record<string, number> {
    const topics = this.cache[String(chatKey)];
    if (!topics || typeof topics !== 'object') return {};
    const result: Record<string, number> = {};
    for (const [alias, tid] of Object.entries(topics)) {
      if (typeof tid === 'number' && Number.isInteger(tid)) result[String(alias)] = tid;
    }
    return result;
  }

  addAlias(chatKey: string, name: string, topicId: number): void {
    const alias = String(name ?? '').trim();
    if (!alias) throw new Error('Alias darf nicht leer sein.');
    const id = Number(topicId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('Topic-ID muss eine positive Ganzzahl sein.');
    }
    this.chatDict(chatKey)[alias] = id;
    this.saveCache();
  }

  removeAlias(chatKey: string, name: string): boolean {
    const topics = this.cache[String(chatKey)];
    if (!topics || typeof topics !== 'object') return false;
    const alias = String(name ?? '').trim();
    if (!(alias in topics)) return false;
    delete topics[alias];
    this.saveCache();
    return true;
  }

  remapTopic(chatKey: string, oldTopicId: number, newTopicId: number): number {
    const topics = this.cache[String(chatKey)];
    if (!topics || typeof topics !== 'object') return 0;
    const oldId = Number(oldTopicId);
    const newId = Number(newTopicId);
    let changed = 0;
    for (const [alias, tid] of Object.entries(topics)) {
      if (tid === oldId) {
        topics[alias] = newId;
        changed += 1;
      }
    }
    if (changed) this.saveCache();
    return changed;
  }

  deleteTopic(chatKey: string, topicId: number): number {
    const topics = this.cache[String(chatKey)];
    if (!topics || typeof topics !== 'object') return 0;
    const id = Number(topicId);
    const removed = Object.entries(topics)
      .filter(([, tid]) => tid === id)
      .map(([alias]) => alias);
    for (const alias of removed) delete topics[alias];
    if (removed.length) this.saveCache();
    return removed.length;
  }

  // ---------------------------------------------------------------- Telegram

  async createTopic(
    gateway: TelegramGateway,
    forumChatId: number | string,
    title: string,
    iconColor?: number,
  ): Promise<number> {
    const normalizedTitle = String(title ?? '').trim();
    if (!normalizedTitle) throw new Error('Topic-Name darf nicht leer sein.');
    const topicId = await gateway.createForumTopic(forumChatId, normalizedTitle, iconColor);
    this.addAlias(String(forumChatId), normalizedTitle, topicId);
    return topicId;
  }

  async getOrCreateTopic(
    gateway: TelegramGateway,
    forumChatId: number | string,
    title: string,
    iconColor?: number,
  ): Promise<number> {
    const chatKey = String(forumChatId);
    if (!this.cache[chatKey] || typeof this.cache[chatKey] !== 'object') this.cache[chatKey] = {};

    const normalizedTitle = title.trim();
    const lookupKey = normalizedTitle.toLowerCase();

    // 1. Smart-Matching im lokalen Cache
    const matched = this.findCachedTopic(chatKey, normalizedTitle);
    if (matched) {
      const chat = this.cache[chatKey] as Record<string, number>;
      if (!(lookupKey in chat)) {
        chat[lookupKey] = matched;
        this.saveCache();
      }
      return matched;
    }

    // 2. Neues Topic anlegen
    logger.info(
      `Topic '${normalizedTitle}' nicht im Cache. Erstelle neues Forum-Topic in Chat ${forumChatId}...`,
    );
    const topicId = await gateway.createForumTopic(forumChatId, normalizedTitle, iconColor);

    const chat = this.cache[chatKey] as Record<string, number>;
    chat[lookupKey] = topicId;
    if (lookupKey.startsWith('@')) chat[lookupKey.slice(1)] = topicId;
    const strippedKey = stripPlatformSuffix(normalizedTitle).trim().toLowerCase();
    if (strippedKey && strippedKey !== lookupKey) chat[strippedKey] = topicId;
    this.saveCache();
    return topicId;
  }

  async forwardMessagesToTopic(
    gateway: TelegramGateway,
    fromChat: number | string,
    toForumChat: number | string,
    messageIds: number[],
    topicId: number,
    dropAuthor = true,
  ): Promise<number[]> {
    if (!messageIds.length) return [];
    logger.info(
      `Leite ${messageIds.length} Nachricht(en) (${messageIds.join(',')}) aus Chat ${fromChat} ` +
        `nach Forum ${toForumChat} in Topic ${topicId} weiter (drop_author=${dropAuthor})...`,
    );
    const forwarded = await gateway.forwardMessages(
      fromChat,
      toForumChat,
      messageIds,
      topicId,
      dropAuthor,
    );
    logger.info(
      `Nachrichten erfolgreich in Topic ${topicId} weitergeleitet. Neue IDs: ${
        forwarded.length ? forwarded.join(',') : 'OK'
      }`,
    );
    return forwarded;
  }
}

export const topicManager = new TopicManager();

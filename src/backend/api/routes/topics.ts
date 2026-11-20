import { Router, type Request, type Response } from 'express';
import { config } from '../../config';
import { logger } from '../../logger';
import { state } from '../../state';
import { topicManager } from '../../topic/manager';
import { requireAuth } from '../middleware/auth';

export const topicsRouter = Router();
topicsRouter.use(requireAuth);

function jsonError(res: Response, message: string, status = 400): void {
  res.status(status).json({ error: message });
}

function configuredForumChatId(): string {
  return String(config.telegram.defaultForumChatId ?? '').trim();
}

function topicChatIds(): string[] {
  const chats: string[] = [];
  for (const [key, value] of Object.entries(topicManager.cache)) {
    if (value && typeof value === 'object') chats.push(String(key));
  }
  const configured = configuredForumChatId();
  if (configured && !chats.includes(configured)) chats.unshift(configured);
  return chats;
}

function resolveTopicChat(raw: unknown): string {
  const configured = configuredForumChatId();
  const candidate = raw === null || raw === undefined || raw === '' ? '' : String(raw).trim();
  const chats = topicChatIds();
  if (candidate) {
    if (chats.includes(candidate) || candidate === configured) return candidate;
    throw new Error('Unbekannter Chat.');
  }
  if (configured) return configured;
  const first = chats[0];
  if (first) return first;
  throw new Error('Kein Forum-Chat konfiguriert.');
}

function validateTopicName(value: unknown): string {
  const name = String(value ?? '').trim();
  if (!name) throw new Error('Name darf nicht leer sein.');
  if (name.length > 128) throw new Error('Name ist zu lang (max. 128 Zeichen).');
  return name;
}

function findAlias(chatId: string, name: string): string | null {
  const target = String(name ?? '').trim().toLowerCase();
  for (const alias of Object.keys(topicManager.listTopics(chatId))) {
    if (alias.trim().toLowerCase() === target) return alias;
  }
  return null;
}

function parseTopicId(value: unknown): number {
  if (typeof value === 'boolean') throw new Error('Topic-ID muss eine positive Ganzzahl sein.');
  let topicId: number;
  if (typeof value === 'number') {
    topicId = value;
  } else {
    const text = String(value ?? '').trim();
    if (!/^\d+$/.test(text)) throw new Error('Topic-ID muss eine positive Ganzzahl sein.');
    topicId = Number.parseInt(text, 10);
  }
  if (!Number.isInteger(topicId) || topicId <= 0) {
    throw new Error('Topic-ID muss eine positive Ganzzahl sein.');
  }
  return topicId;
}

function chooseDisplayName(aliases: string[]): string {
  const score = (alias: string): number => {
    let points = 0;
    if (!alias.startsWith('@')) points += 2;
    if (!alias.startsWith('_')) points += 1;
    if (!/^\d+$/.test(alias)) points += 2;
    if (alias.includes(' ')) points += 1;
    if (/[A-Z]/.test(alias)) points += 1;
    if (alias.includes('.')) points -= 1;
    return points;
  };
  const sorted = [...aliases].sort((a, b) => {
    const byScore = score(b) - score(a);
    if (byScore !== 0) return byScore;
    if (a.length !== b.length) return a.length - b.length;
    return a.toLowerCase().localeCompare(b.toLowerCase());
  });
  return sorted[0] ?? '';
}

function buildTopicsPayload(chatId: string): Record<string, unknown> {
  const groups = new Map<number, string[]>();
  for (const [alias, topicId] of Object.entries(topicManager.listTopics(chatId))) {
    const list = groups.get(topicId) ?? [];
    list.push(alias);
    groups.set(topicId, list);
  }

  const topics = Array.from(groups.entries()).map(([topicId, aliases]) => {
    const sorted = [...aliases].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    return {
      topic_id: topicId,
      name: chooseDisplayName(sorted),
      aliases: sorted,
      link: `https://t.me/RippersArchiv/${topicId}`,
    };
  });
  topics.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  return {
    chat_id: chatId,
    chats: topicChatIds(),
    forum_chat_id: configuredForumChatId(),
    topics,
    alias_count: topics.reduce((sum, row) => sum + row.aliases.length, 0),
  };
}

topicsRouter.get('/', (req, res) => {
  try {
    const chatId = resolveTopicChat(req.query['chat_id']);
    res.json(buildTopicsPayload(chatId));
  } catch (error) {
    jsonError(res, (error as Error).message);
  }
});

topicsRouter.post('/', async (req, res) => {
  const data = req.body as Record<string, unknown>;
  if (!data || typeof data !== 'object') {
    jsonError(res, 'JSON-Objekt erwartet.');
    return;
  }
  try {
    const chatId = resolveTopicChat(data['chat_id']);
    const name = validateTopicName(data['name']);
    const createRaw = data['create'];
    const createInTelegram =
      createRaw === true || ['true', '1', 'yes'].includes(String(createRaw).trim().toLowerCase());

    const existingAlias = findAlias(chatId, name);
    const existingTopicId =
      existingAlias !== null ? topicManager.listTopics(chatId)[existingAlias] ?? null : null;

    let topicId: number;
    if (createInTelegram) {
      if (existingAlias !== null) {
        jsonError(
          res,
          `Der Name '${existingAlias}' existiert bereits (Topic ${existingTopicId}). Bitte einen anderen Namen wählen.`,
          409,
        );
        return;
      }
      if (!state.gateway.isConnected()) {
        jsonError(res, 'Telegram-Client ist noch nicht verbunden.', 503);
        return;
      }
      topicId = await topicManager.createTopic(state.gateway, chatId, name);
    } else {
      topicId = parseTopicId(data['topic_id']);
      if (existingAlias !== null && existingTopicId !== topicId) {
        jsonError(
          res,
          `Der Name '${existingAlias}' ist bereits dem Topic ${existingTopicId} zugeordnet.`,
          409,
        );
        return;
      }
      topicManager.addAlias(chatId, name, topicId);
    }

    logger.info(`Topic-Verwaltung: '${name}' -> Topic ${topicId} hinzugefügt.`);
    res.json({ status: 'ok', topic_id: topicId });
  } catch (error) {
    const message = (error as Error).message;
    if (message.startsWith('Telegram')) jsonError(res, message, 502);
    else jsonError(res, message);
  }
});

topicsRouter.patch('/', (req, res) => {
  const data = req.body as Record<string, unknown>;
  if (!data || typeof data !== 'object') {
    jsonError(res, 'JSON-Objekt erwartet.');
    return;
  }
  try {
    const chatId = resolveTopicChat(data['chat_id']);
    const oldTopicId = parseTopicId(data['topic_id']);
    const newTopicId = parseTopicId(data['new_topic_id']);

    const existingIds = new Set(Object.values(topicManager.listTopics(chatId)));
    if (!existingIds.has(oldTopicId)) {
      jsonError(res, 'Topic nicht gefunden.', 404);
      return;
    }
    if (newTopicId !== oldTopicId && existingIds.has(newTopicId)) {
      jsonError(
        res,
        `Topic-ID ${newTopicId} existiert bereits. Bitte zuerst die andere Gruppe löschen.`,
        409,
      );
      return;
    }

    const changed = topicManager.remapTopic(chatId, oldTopicId, newTopicId);
    logger.info(
      `Topic-Verwaltung: Topic ${oldTopicId} -> ${newTopicId} (${changed} Alias(e) aktualisiert).`,
    );
    res.json({ status: 'ok', changed });
  } catch (error) {
    jsonError(res, (error as Error).message);
  }
});

topicsRouter.delete('/', (req, res) => {
  try {
    const chatId = resolveTopicChat(req.query['chat_id']);
    const topicId = parseTopicId(req.query['topic_id']);
    const removed = topicManager.deleteTopic(chatId, topicId);
    if (!removed) {
      jsonError(res, 'Topic nicht gefunden.', 404);
      return;
    }
    logger.info(`Topic-Verwaltung: Topic ${topicId} mit ${removed} Alias(en) gelöscht.`);
    res.json({ status: 'ok', removed });
  } catch (error) {
    jsonError(res, (error as Error).message);
  }
});

topicsRouter.post('/alias', (req, res) => {
  const data = req.body as Record<string, unknown>;
  if (!data || typeof data !== 'object') {
    jsonError(res, 'JSON-Objekt erwartet.');
    return;
  }
  try {
    const chatId = resolveTopicChat(data['chat_id']);
    const name = validateTopicName(data['name']);
    const topicId = parseTopicId(data['topic_id']);

    const existingAlias = findAlias(chatId, name);
    const existing =
      existingAlias !== null ? topicManager.listTopics(chatId)[existingAlias] ?? null : null;
    if (existing !== null && existing !== topicId) {
      jsonError(res, `Der Name '${existingAlias}' ist bereits dem Topic ${existing} zugeordnet.`, 409);
      return;
    }
    topicManager.addAlias(chatId, name, topicId);
    logger.info(`Topic-Verwaltung: Alias '${name}' -> Topic ${topicId} hinzugefügt.`);
    res.json({ status: 'ok' });
  } catch (error) {
    jsonError(res, (error as Error).message);
  }
});

topicsRouter.delete('/alias', (req, res) => {
  try {
    const chatId = resolveTopicChat(req.query['chat_id']);
    const name = validateTopicName(req.query['name']);
    if (!topicManager.removeAlias(chatId, name)) {
      jsonError(res, 'Alias nicht gefunden.', 404);
      return;
    }
    logger.info(`Topic-Verwaltung: Alias '${name}' entfernt.`);
    res.json({ status: 'ok' });
  } catch (error) {
    jsonError(res, (error as Error).message);
  }
});

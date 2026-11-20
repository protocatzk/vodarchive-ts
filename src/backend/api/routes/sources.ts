import { Router } from 'express';
import { rssArchiver } from '../../rss/archiver';
import { sourceStore } from '../../sources/store';
import { fetchStreamrecorder, previewStreamrecorder } from '../../sources/streamrecorder';
import { settingsStore } from '../../settings/store';
import { state } from '../../state';
import { topicManager } from '../../topic/manager';
import { requireAuth } from '../middleware/auth';

export const sourcesRouter = Router();
sourcesRouter.use(requireAuth);

sourcesRouter.get('/', (_req, res) => {
  res.json({ sources: sourceStore.list() });
});

sourcesRouter.post('/test', async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const type = String(body['type'] ?? 'rss').toLowerCase();
  if (type !== 'rss' && type !== 'opml' && type !== 'ytdlp' && type !== 'streamrecorder') {
    res.status(400).json({ error: "Typ muss 'rss', 'opml', 'ytdlp' oder 'streamrecorder' sein." });
    return;
  }
  const url = String(body['url'] ?? '').trim();

  if (type === 'streamrecorder') {
    const targetsRaw = body['targets'];
    const targets = Array.isArray(targetsRaw)
      ? targetsRaw.map((entry) => String(entry))
      : String(targetsRaw ?? '')
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean);
    const result = await previewStreamrecorder({
      apiBaseUrl: String(body['apiBaseUrl'] ?? url).trim() || undefined,
      cookie: String(body['cookie'] ?? '').trim() || undefined,
      listPath: String(body['listPath'] ?? '').trim() || undefined,
      itemsPath: String(body['itemsPath'] ?? '').trim() || undefined,
      targets,
      onlyNew: body['onlyNew'] !== false,
      limit: Number(body['limit'] ?? 10) || 10,
    });
    res.status(result.ok ? 200 : 400).json({
      ok: result.ok,
      feeds: 1,
      items: result.items,
      total: result.total,
      targets: result.targets,
      sample: result.sample,
      ...(result.error ? { error: result.error } : {}),
    });
    return;
  }

  if (!url) {
    res.status(400).json({ error: 'URL darf nicht leer sein.' });
    return;
  }
  const result = await rssArchiver.preview(type as 'rss' | 'opml' | 'ytdlp', url);
  res.status(result.ok ? 200 : 400).json(result);
});

sourcesRouter.post('/', (req, res) => {
  try {
    const source = sourceStore.add((req.body ?? {}) as Record<string, unknown>);
    res.status(201).json({ status: 'ok', source });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

sourcesRouter.patch('/:id', (req, res) => {
  try {
    const source = sourceStore.update(req.params['id'] ?? '', (req.body ?? {}) as Record<string, unknown>);
    res.json({ status: 'ok', source });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

sourcesRouter.delete('/:id', (req, res) => {
  if (!sourceStore.remove(req.params['id'] ?? '')) {
    res.status(404).json({ error: 'Quelle nicht gefunden.' });
    return;
  }
  res.json({ status: 'ok' });
});

sourcesRouter.post('/:id/check', (req, res) => {
  const id = req.params['id'] ?? '';
  if (!sourceStore.get(id)) {
    res.status(404).json({ error: 'Quelle nicht gefunden.' });
    return;
  }
  const started = rssArchiver.triggerSource(id);
  res.status(started ? 202 : 409).json({ status: started ? 'started' : 'busy' });
});

sourcesRouter.post('/:id/preview', async (req, res) => {
  const source = sourceStore.getInternal(req.params['id'] ?? '');
  if (!source) {
    res.status(404).json({ error: 'Quelle nicht gefunden.' });
    return;
  }
  if (source.type !== 'streamrecorder') {
    res.status(400).json({ error: 'Vorschau nur für Streamrecorder-Quellen.' });
    return;
  }
  try {
    const result = await fetchStreamrecorder(source);
    res.json({
      ok: true,
      total: result.total,
      targets: result.targets.length,
      items: result.items.slice(0, 50).map((item) => ({
        id: item.id,
        recordingId: item.recordingId,
        title: item.title,
        streamer: item.streamer,
        platform: item.platform,
        published: item.published,
        filesizeMb: item.filesizeMb,
        thumbnail: item.thumbnail,
        url: item.url,
      })),
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: (error as Error).message });
  }
});

sourcesRouter.post('/:id/ensure-topics', async (req, res) => {
  const source = sourceStore.getInternal(req.params['id'] ?? '');
  if (!source) {
    res.status(404).json({ error: 'Quelle nicht gefunden.' });
    return;
  }
  if (source.type !== 'streamrecorder') {
    res.status(400).json({ error: 'Themen nur für Streamrecorder-Quellen.' });
    return;
  }
  if (!state.gateway.isConnected()) {
    res.status(503).json({ error: 'Telegram-Client ist nicht verbunden.' });
    return;
  }
  const chatId =
    (source.testMode && source.testForumChatId) ||
    settingsStore.get().telegram.forumChatId;
  if (!chatId) {
    res.status(400).json({ error: 'Kein Forum-Chat konfiguriert.' });
    return;
  }

  try {
    const result = await fetchStreamrecorder(source);
    const names = Array.from(
      new Set(result.items.map((item) => item.streamer.trim()).filter(Boolean)),
    ).slice(0, 50);

    const outcomes: Array<{
      name: string;
      topicId?: number;
      existing?: boolean;
      error?: string;
    }> = [];

    for (const name of names) {
      const existing = topicManager.findCachedTopic(chatId, name) !== null;
      try {
        const topicId = await topicManager.getOrCreateTopic(state.gateway, chatId, name);
        outcomes.push({ name, topicId, existing });
      } catch (error) {
        outcomes.push({ name, error: (error as Error).message });
      }
    }

    res.json({
      ok: true,
      chatId,
      streamers: outcomes,
      created: outcomes.filter((entry) => !entry.existing && !entry.error).length,
      existing: outcomes.filter((entry) => entry.existing && !entry.error).length,
      failed: outcomes.filter((entry) => entry.error).length,
    });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

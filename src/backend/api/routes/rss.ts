import { Router } from 'express';
import { config } from '../../config';
import { rssArchiver } from '../../rss/archiver';
import { requireAuth } from '../middleware/auth';

export const rssRouter = Router();

rssRouter.get('/status', (_req, res) => {
  res.json(rssArchiver.status());
});

rssRouter.post('/check', (_req, res) => {
  if (!config.rss.enabled) {
    res.status(503).json({ status: 'disabled' });
    return;
  }
  const started = rssArchiver.trigger();
  res.status(started ? 202 : 409).json({ status: started ? 'started' : 'busy' });
});

rssRouter.post('/backfill', (req, res) => {
  if (!config.rss.enabled) {
    res.status(503).json({ status: 'disabled' });
    return;
  }
  let limit = Number.parseInt(String(req.query['limit'] ?? '10'), 10);
  if (!Number.isFinite(limit)) limit = 10;
  limit = Math.max(1, Math.min(limit, 50));
  const started = rssArchiver.triggerBackfill(limit);
  res.status(started ? 202 : 409).json({ status: started ? 'started' : 'busy', limit });
});

rssRouter.post('/retry', requireAuth, (_req, res) => {
  if (!config.rss.enabled) {
    res.status(503).json({ status: 'disabled' });
    return;
  }
  const reset = rssArchiver.resetRetries();
  const started = rssArchiver.trigger();
  res.json({ status: 'ok', reset, poll_started: started });
});

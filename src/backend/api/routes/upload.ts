import { Router } from 'express';
import { logger } from '../../logger';
import { state } from '../../state';
import { makeKey } from '../../jobs/job_store';
import { enqueueJob } from '../../jobs/worker';

export const uploadRouter = Router();

uploadRouter.post('/', (req, res) => {
  const data = req.body as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  if (!data['download_url']) {
    res.status(400).json({ error: 'Missing download_url' });
    return;
  }

  const key = makeKey(data);
  const queued = state.waitingQueue.some((item) => item.key === key);
  const running = state.activeJob?.key === key;
  if (state.jobStore.isDone(key) || queued || running) {
    logger.info(`[${key}] Doppelter Upload-Request ignoriert (Job laeuft bereits oder ist abgeschlossen).`);
    res.status(202).json({ status: 'duplicate', key });
    return;
  }

  const { record } = enqueueJob(data);
  res.status(202).json({
    status: 'queued',
    key: record.key,
    job_id: record.job_id,
  });
});

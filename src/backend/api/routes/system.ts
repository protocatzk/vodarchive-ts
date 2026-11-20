import { Router, type Request, type Response } from 'express';
import { config } from '../../config';
import { rssArchiver } from '../../rss/archiver';
import { state } from '../../state';
import { requireAuth } from '../middleware/auth';

export const systemRouter = Router();

function resolveJobKey(keyRaw: string | null, jobIdRaw: string | null): string | null {
  if (keyRaw) return keyRaw;
  if (!jobIdRaw) return null;
  const inQueue = state.waitingQueue.find((item) => item.job_id === jobIdRaw);
  if (inQueue) return inQueue.key;
  if (state.activeJob && state.activeJob.job_id === jobIdRaw) return state.activeJob.key;
  const pending = state.jobStore.pending().find((record) => record.job_id === jobIdRaw);
  return pending ? pending.key : null;
}

systemRouter.post('/jobs/cancel', requireAuth, (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const key = resolveJobKey(
    String(body['key'] ?? '').trim() || null,
    String(body['job_id'] ?? '').trim() || null,
  );
  if (!key) {
    res.status(404).json({ error: 'Job nicht gefunden', status: 'not_found' });
    return;
  }
  const result = state.requestCancel(key);
  if (result === 'not_found') {
    res.status(404).json({ error: 'Job nicht gefunden', status: 'not_found', key });
    return;
  }
  res.status(202).json({ status: result, key });
});

export function healthHandler(_req: Request, res: Response): void {
  res.json({
    status: 'ok',
    bot: 'Ripperbot',
    busy: Boolean(state.activeJob),
    queue_length: state.waitingQueue.length,
    split_threshold_mb: 1800,
    target_part_size_mb: 1400,
    parallel_workers: config.upload.parallelWorkers,
    chat_id: config.telegram.defaultChatId,
    forum_chat_id: config.telegram.defaultForumChatId,
    forward_drop_author: config.telegram.forwardDropAuthor,
    telegram_connected: state.gateway.isConnected(),
    rss: rssArchiver.summary(),
  });
}

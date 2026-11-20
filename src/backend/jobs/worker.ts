import { config } from '../config';
import { logger } from '../logger';
import { state, type ActiveJob, type HistoryItem } from '../state';
import { makeKey, type JobRecord } from './job_store';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickString(payload: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function stageLabel(stage: string): string {
  switch (stage) {
    case 'queued':
      return 'Wartet...';
    case 'download':
      return 'Lade VOD herunter...';
    case 'split':
      return 'Teile Datei auf...';
    case 'upload':
      return 'Lade nach Telegram hoch...';
    case 'cancelling':
      return 'Abbruch läuft...';
    default:
      return 'In Bearbeitung...';
  }
}

export function enqueueJob(payload: Record<string, unknown>, jobId?: string): JobRecord {
  const key = makeKey(payload);
  const id = jobId || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const record = state.jobStore.create(key, payload, id);

  state.addQueueItem({
    key: record.key,
    job_id: record.job_id,
    streamer: pickString(payload, ['streamer', 'channel', 'author', 'uploader']) || 'Unbekannt',
    title: pickString(payload, ['title', 'name', 'vod_title']) || 'Kein Titel',
    source: pickString(payload, ['source']) || 'streamrecorder',
  });

  logger.info(`Job angenommen: ${record.job_id} (key=${record.key}).`);
  void drainQueue();
  return record;
}


export async function drainQueue(): Promise<void> {
  if (state.processing) return;
  state.processing = true;
  try {
    while (state.waitingQueue.length > 0 && !state.shuttingDown) {
      const item = state.waitingQueue[0];
      if (!item) break;
      state.removeQueueItem(item.key);
      if (state.isCancelled(item.key)) {
        state.jobStore.remove(item.key);
        continue;
      }
      await processJob(item.key, item.job_id, item.streamer, item.title);
    }
  } finally {
    state.processing = false;
    state.activeJob = null;
  }
}

async function processJob(key: string, jobId: string, streamer: string, title: string): Promise<void> {
  const record = state.jobStore.get(key);
  if (!record) return;

  try {
    state.jobStore.markRunning(key, 'download');
  } catch {
    return;
  }

  const totalBytes = 1_800_000_000;
  const active: ActiveJob = {
    key,
    job_id: jobId,
    streamer,
    title,
    stage: 'download',
    stage_label: stageLabel('download'),
    pct: 0,
    bytes_done: 0,
    bytes_total: totalBytes,
    speed_mbps: 0,
    eta_seconds: 0,
  };
  state.activeJob = active;

  const simulate = config.jobs.simulate;
  const stepsPerStage = simulate ? 6 : 1;
  const delay = simulate ? 700 : 0;

  const stages: Array<{ stage: 'download' | 'split' | 'upload'; from: number; to: number }> = [
    { stage: 'download', from: 0, to: 70 },
    { stage: 'split', from: 70, to: 80 },
    { stage: 'upload', from: 80, to: 100 },
  ];

  try {
    for (const phase of stages) {
      for (let step = 1; step <= stepsPerStage; step += 1) {
        if (state.isCancelled(key)) {
          finish(key, active, 'cancelled');
          return;
        }
        const pct = Math.round(phase.from + ((phase.to - phase.from) * step) / stepsPerStage);
        active.stage = phase.stage;
        active.stage_label = stageLabel(phase.stage);
        active.pct = pct;
        active.bytes_done = Math.round((totalBytes * pct) / 100);
        active.speed_mbps = phase.stage === 'download' ? 42.5 : 0;
        active.eta_seconds = Math.max(0, Math.round(((100 - pct) / 100) * 120));
        state.jobStore.update(key, {
          stage: phase.stage,
          downloaded: pct >= 70,
          downloaded_size: Math.round((totalBytes * pct) / 100),
        });
        if (delay) await sleep(delay);
      }
    }

    if (state.isCancelled(key)) {
      finish(key, active, 'cancelled');
      return;
    }
    finish(key, active, 'success');
  } catch (error) {
    logger.error(`[${key}] Job fehlgeschlagen: ${String(error)}`);
    try {
      state.jobStore.fail(key, String(error));
    } catch {
      /* ignore */
    }
    finish(key, active, 'failed', String(error));
  }
}

function finish(
  key: string,
  active: ActiveJob,
  status: 'success' | 'failed' | 'cancelled',
  error?: string,
): void {
  const history: HistoryItem = {
    finished_at: new Date().toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }),
    streamer: active.streamer,
    title: active.title,
    parts: 1,
    total_size_mb: Math.round(active.bytes_total / (1024 * 1024)),
    topic_id: null,
    topic_name: '',
    status,
  };
  state.addHistory(history);

  try {
    if (status === 'success') {
      state.jobStore.complete(key);
      logger.info(`[${key}] Job abgeschlossen.`);
    } else if (status === 'cancelled') {
      state.jobStore.remove(key);
      logger.info(`[${key}] Job abgebrochen.`);
    } else {
      state.jobStore.fail(key, error || 'unbekannter Fehler');
    }
  } catch (cleanupError) {
    logger.warn(`[${key}] Aufraeumen fehlgeschlagen: ${String(cleanupError)}`);
  }

  state.activeJob = null;
}

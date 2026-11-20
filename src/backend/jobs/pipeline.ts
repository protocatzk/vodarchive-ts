import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { logger } from '../logger';
import { settingsStore } from '../settings/store';
import { state, type ActiveJob } from '../state';
import { topicManager } from '../topic/manager';
import type { JobRecord } from './job_store';
import { downloadHttp, downloadWithYtDlp, probeVideo, splitFile } from './media';
import type { VideoMetadata } from '../telegram/gateway';

export class CancelledError extends Error {
  constructor() {
    super('Job abgebrochen.');
    this.name = 'CancelledError';
  }
}

/** Markiert eine Streamrecorder-Aufnahme nach erfolgreichem Upload als heruntergeladen. */
async function markStreamrecorderDownloaded(payload: Record<string, unknown>): Promise<void> {
  const source = str(payload, ['source']);
  const recordingId = str(payload, ['recording_id']);
  if (source === 'rss' || !recordingId) return;
  if (payload['skip_setdownloaded'] === true) {
    logger.info(`[${recordingId}] Testmodus: setdownloaded wird übersprungen.`);
    return;
  }
  const cookie = str(payload, ['cookie']) || config.streamrecorder.cookie;
  if (!cookie) return;

  const base = (str(payload, ['api_base_url']) || config.streamrecorder.apiBaseUrl).replace(/\/+$/, '');
  const url = `${base}/api/user/setdownloaded?fileid=${encodeURIComponent(recordingId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Cookie: cookie,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      },
    });
    const body = await response.text().catch(() => '');
    logger.info(
      `Streamrecorder als heruntergeladen markiert: ${recordingId} (HTTP ${response.status}${body ? `: ${body.slice(0, 80)}` : ''}).`,
    );
  } catch (error) {
    logger.warn(`Streamrecorder-Markierung fehlgeschlagen für ${recordingId}: ${String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

export interface PipelineResult {
  status: 'success' | 'cancelled' | 'failed';
  error?: string;
  topicId?: number;
  topicName?: string;
  parts?: number;
  totalSizeMb?: number;
}

function str(payload: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallback;
}

function bool(payload: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string' && ['true', '1', 'yes'].includes(value.toLowerCase())) return true;
  }
  return false;
}

function guardCancel(key: string, controller: AbortController): () => void {
  const timer = setInterval(() => {
    if (state.isCancelled(key)) controller.abort();
  }, 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** Echte Upload-Pipeline: Download -> optionaler Split -> Telegram-Upload. */
export async function runUploadPipeline(
  record: JobRecord,
  active: ActiveJob,
): Promise<PipelineResult> {
  const key = record.key;
  const payload = record.payload;
  const downloadUrl = str(payload, ['download_url']);
  if (!downloadUrl) throw new Error('Missing download_url');

  const streamer = str(payload, ['streamer', 'channel', 'author'], 'Unbekannt');
  const title = str(payload, ['title', 'name'], 'Livestream Recording');
  const source = str(payload, ['source'], 'streamrecorder');
  const useYtDlp = bool(payload, ['use_ytdlp']) || source === 'rss';
  const chatId =
    str(payload, ['forum_chat_id']) || String(settingsStore.get().telegram.forumChatId ?? '').trim();
  const topicName = str(payload, ['topic_name']) || streamer || 'Allgemein';

  if (!chatId) {
    throw new Error('Kein Ziel-Forum konfiguriert (TELEGRAM_FORUM_CHAT_ID).');
  }
  if (!state.gateway.isConnected()) {
    throw new Error('Telegram-Client ist noch nicht verbunden.');
  }

  const jobDir = String(record['job_dir'] ?? state.jobStore.jobDirFor(key));
  fs.mkdirSync(jobDir, { recursive: true });

  const controller = new AbortController();
  const stopGuard = guardCancel(key, controller);

  let sourceFile = path.join(jobDir, 'source.mp4');
  let extraFiles: string[] = [];

  const updateActive = (patch: Partial<ActiveJob>): void => {
    Object.assign(active, patch);
  };

  try {
    // 1. Download
    updateActive({ stage: 'download', stage_label: 'Lade VOD herunter...', pct: 0 });
    state.jobStore.update(key, { stage: 'download' });
    logger.info(`[${key}] Starte Download (${useYtDlp ? 'yt-dlp' : 'HTTP'}): ${downloadUrl}`);

    const onDownload = (done: number, total: number): void => {
      if (state.isCancelled(key)) return;
      const pct = total > 0 ? Math.min(69, Math.round((done / total) * 70)) : 0;
      updateActive({
        pct,
        bytes_done: done,
        bytes_total: total,
        speed_mbps: 0,
      });
    };

    if (useYtDlp) {
      await downloadWithYtDlp(downloadUrl, sourceFile, {
        onProgress: onDownload,
        signal: controller.signal,
      });
    } else {
      await downloadHttp(downloadUrl, sourceFile, {
        onProgress: onDownload,
        signal: controller.signal,
      });
    }
    if (state.isCancelled(key)) throw new CancelledError();

    if (!fs.existsSync(sourceFile)) {
      // yt-dlp kann eine andere Endung erzeugt haben.
      const found = fs
        .readdirSync(jobDir)
        .find((entry) => entry.startsWith('source.') && !entry.endsWith('.part'));
      if (!found) throw new Error('Download-Datei wurde nicht erzeugt.');
      sourceFile = path.join(jobDir, found);
    }

    const sourceSize = fs.statSync(sourceFile).size;
    updateActive({ bytes_done: sourceSize, bytes_total: sourceSize, pct: 70 });
    state.jobStore.update(key, { downloaded: true, downloaded_size: sourceSize });
    logger.info(`[${key}] Download fertig (${(sourceSize / (1024 ** 2)).toFixed(1)} MB).`);

    // 2. Split (nur wenn noetig)
    let parts: string[] = [sourceFile];
    if (sourceSize > settingsStore.get().upload.splitThresholdBytes) {
      updateActive({ stage: 'split', stage_label: 'Teile Datei auf...', pct: 70 });
      state.jobStore.update(key, { stage: 'split' });
      const split = await splitFile(sourceFile, settingsStore.get().upload.targetPartSizeBytes, {
        signal: controller.signal,
        onProgress: (pctProgress) =>
          updateActive({ pct: 70 + Math.round((pctProgress / 100) * 10) }),
      });
      parts = split.parts;
      extraFiles = parts.filter((part) => part !== sourceFile);
      updateActive({ pct: 80 });
      logger.info(`[${key}] Datei in ${parts.length} Teil(e) aufgeteilt.`);
    }
    if (state.isCancelled(key)) throw new CancelledError();

    // 3. Topic ermitteln/anlegen
    const topicId = await topicManager.getOrCreateTopic(
      state.gateway,
      chatId,
      topicName,
    );
    state.jobStore.update(key, { topic_id: topicId });
    logger.info(`[${key}] Ziel-Topic: ${topicId} ('${topicName}').`);

    // 4. Upload
    updateActive({ stage: 'upload', stage_label: 'Lade nach Telegram hoch...', pct: 80 });
    state.jobStore.update(key, { stage: 'upload' });

    const meta: VideoMetadata | null = await probeVideo(parts[0] ?? sourceFile);
    const uploadedIds: number[] = [];
    const perPart = parts.length > 0 ? 20 / parts.length : 20;

    for (let index = 0; index < parts.length; index += 1) {
      if (state.isCancelled(key)) throw new CancelledError();
      const part = parts[index];
      if (!part) continue;
      const partSize = fs.statSync(part).size;
      const caption =
        parts.length > 1
          ? `${streamer} – ${title} (Teil ${index + 1}/${parts.length})`
          : `${streamer} – ${title}`;

      const messageId = await state.gateway.sendVideoToTopic(
        chatId,
        topicId,
        part,
        caption,
        meta,
        (progress) => {
          const overall = 80 + index * perPart + (progress.pct / 100) * perPart;
          updateActive({
            pct: Math.min(99, Math.round(overall)),
            bytes_done: index * partSize + progress.uploadedBytes,
            bytes_total: parts.reduce((sum, item) => sum + fs.statSync(item).size, 0),
          });
        },
      );
      uploadedIds.push(messageId);
      state.jobStore.update(key, { uploaded_message_ids: [...uploadedIds] });
      logger.info(`[${key}] Teil ${index + 1}/${parts.length} hochgeladen (Msg ${messageId}).`);
    }

    updateActive({ pct: 100 });

    await markStreamrecorderDownloaded(payload);

    if (!settingsStore.get().jobs.keepFiles) {
      for (const file of [sourceFile, ...extraFiles]) {
        fs.rmSync(file, { force: true });
      }
    }

    return {
      status: 'success',
      topicId,
      topicName,
      parts: parts.length,
      totalSizeMb: Math.round(sourceSize / (1024 ** 2)),
    };
  } catch (error) {
    if (error instanceof CancelledError || state.isCancelled(key)) {
      return { status: 'cancelled' };
    }
    return { status: 'failed', error: (error as Error).message };
  } finally {
    stopGuard();
  }
}

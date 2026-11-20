import { config } from './config';
import { enqueueJob } from './jobs/worker';
import { logger } from './logger';
import { rssArchiver } from './rss/archiver';
import { startServer } from './server';
import { state } from './state';
import { GramJsTelegramGateway } from './telegram/gramjs';

function logStartup(): void {
  logger.info('==============================================');
  logger.info(' VODArchive (TypeScript + Vue)');
  logger.info('==============================================');
  logger.info(`Datenverzeichnis: ${config.paths.baseDir}`);
  logger.info(`Telegram Gateway: ${state.gateway.name} (verbunden=${state.gateway.isConnected()})`);

  if (config.auth.devMode) {
    logger.warn(
      `AUTH_DEV_MODE aktiv – Dashboard-Login wird uebersprungen (Nutzer: ${config.auth.devUser}). ` +
        'Nur fuer lokale Entwicklung gedacht!',
    );
  }
  const missingTelegram: string[] = [];
  if (!config.telegram.apiId) missingTelegram.push('TELEGRAM_API_ID');
  if (!config.telegram.apiHash) missingTelegram.push('TELEGRAM_API_HASH');
  if (!config.telegram.botToken) missingTelegram.push('TELEGRAM_BOT_TOKEN');
  if (missingTelegram.length) {
    logger.warn(
      `Telegram deaktiviert – fehlende Werte: ${missingTelegram.join(', ')}. ` +
        'Dashboard-Login liefert dann 503.',
    );
  }
  const missingChats: string[] = [];
  if (!config.telegram.defaultChatId) missingChats.push('TELEGRAM_CHAT_ID');
  if (!config.telegram.defaultForumChatId) missingChats.push('TELEGRAM_FORUM_CHAT_ID');
  if (missingChats.length) {
    logger.warn(
      `Uploads benoetigen Ziel-Chats – fehlende Werte: ${missingChats.join(', ')}.`,
    );
  }
  if (config.telegram.allowedDashboardUsers.length === 0) {
    logger.warn(
      'ALLOWED_DASHBOARD_USERS ist leer – niemand kann sich am Dashboard anmelden.',
    );
  }
  if (config.jobs.simulate) {
    logger.info('SIMULATE_JOBS aktiv – Uploads werden simuliert (kein echter Download/Upload).');
  }
}

async function initTelegram(): Promise<void> {
  if (!config.telegram.apiId || !config.telegram.apiHash || !config.telegram.botToken) {
    return;
  }
  const gateway = new GramJsTelegramGateway();
  try {
    await gateway.connect();
    state.setGateway(gateway);
    gateway.startAuthFlow();
    logger.info(`Telegram verbunden als @${state.botUsername || '?'}.`);
  } catch (error) {
    logger.error(`Telegram-Verbindung fehlgeschlagen: ${String(error)}`);
  }
}

function registerRssHandler(): void {
  rssArchiver.onItem = async (item) => {
    const forumChatId =
      config.rss.archiveForumChatId || config.telegram.defaultForumChatId || undefined;
    const data: Record<string, unknown> = {
      download_url: item.url,
      use_ytdlp: true,
      source: 'rss',
      source_url: item.url,
      recording_id: item.recordingId,
      streamer: item.channel,
      title: item.title,
      thumbnail_url: item.thumbnail,
      platform: item.platform,
      recorded_at: item.publishedIso,
      chat_id: config.rss.archiveChatId || config.telegram.defaultChatId,
      forum_chat_id: forumChatId,
      topic_name: config.rss.topicPerFeed ? item.channel : undefined,
    };

    const { record, done } = enqueueJob(data, undefined, true);
    if (!done) return;
    const outcome = await done;
    if (outcome.status !== 'success') {
      throw new Error(outcome.error || `RSS-Job ${record.job_id} ${outcome.status}`);
    }
  };
}

function shutdown(signal: string): void {
  if (state.shuttingDown) return;
  state.shuttingDown = true;
  logger.info(`${signal} empfangen – fahre herunter...`);
  rssArchiver.stop();
  setTimeout(() => process.exit(0), 500).unref();
}

async function main(): Promise<void> {
  logStartup();
  registerRssHandler();
  await initTelegram();
  rssArchiver.start();
  startServer();
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void main();

import { config } from './config';
import { enqueueJob } from './jobs/worker';
import { logger } from './logger';
import { rssArchiver } from './rss/archiver';
import { startServer } from './server';
import { settingsStore } from './settings/store';
import { sourceStore } from './sources/store';
import { state } from './state';
import { GramJsTelegramGateway } from './telegram/gramjs';
import { startWorkflowScheduler } from './workflows/runner';
import { workflowStore } from './workflows/store';

function logStartup(): void {
  const settings = settingsStore.get();
  logger.info('==============================================');
  logger.info(' VODArchive (TypeScript + Vue)');
  logger.info('==============================================');
  logger.info(`Datenverzeichnis: ${config.paths.baseDir}`);
  logger.info(`Settings: ${settingsStore.file}`);
  logger.info(`Quellen: ${sourceStore.listEnabled().length} aktiv, Workflows: ${workflowStore.list().length}`);
  logger.info(`Telegram Gateway: ${state.gateway.name} (verbunden=${state.gateway.isConnected()})`);

  if (config.auth.devMode) {
    logger.warn(
      `AUTH_DEV_MODE aktiv – Dashboard-Login wird uebersprungen (Nutzer: ${config.auth.devUser}). ` +
        'Nur fuer lokale Entwicklung gedacht!',
    );
  }

  const missingTelegram: string[] = [];
  if (!settings.telegram.apiId) missingTelegram.push('TELEGRAM_API_ID');
  if (!settings.telegram.apiHash) missingTelegram.push('TELEGRAM_API_HASH');
  if (!settings.telegram.botToken) missingTelegram.push('TELEGRAM_BOT_TOKEN');
  if (missingTelegram.length) {
    logger.warn(
      `Telegram deaktiviert – fehlende Werte: ${missingTelegram.join(', ')}. ` +
        'Dashboard-Login liefert dann 503.',
    );
  }
  if (!settings.telegram.chatId) logger.warn('TELEGRAM_CHAT_ID fehlt – Uploads benoetigen ein Ziel.');
  if (!settings.telegram.forumChatId) {
    logger.warn('TELEGRAM_FORUM_CHAT_ID fehlt – Topic-Zuordnung nicht moeglich.');
  }
  if (settings.telegram.allowedDashboardUsers.length === 0) {
    logger.warn('ALLOWED_DASHBOARD_USERS ist leer – niemand kann sich am Dashboard anmelden.');
  }
  if (settings.jobs.simulate) {
    logger.info('SIMULATE_JOBS aktiv – Uploads werden simuliert (kein echter Download/Upload).');
  }
}

async function initTelegram(): Promise<void> {
  const telegram = settingsStore.get().telegram;
  if (!telegram.apiId || !telegram.apiHash || !telegram.botToken) return;

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
    const settings = settingsStore.get();
    const forumChatId =
      settings.rss.archiveForumChatId || settings.telegram.forumChatId || undefined;
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
      chat_id: settings.rss.archiveChatId || settings.telegram.chatId,
      forum_chat_id: forumChatId,
      topic_name: settings.rss.topicPerFeed ? item.channel : undefined,
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
  startWorkflowScheduler();
  startServer();
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void main();

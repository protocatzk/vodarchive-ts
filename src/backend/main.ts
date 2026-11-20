import { config } from './config';
import { logger } from './logger';
import { rssArchiver } from './rss/archiver';
import { startServer } from './server';
import { state } from './state';

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
  if (!config.telegram.apiId || !config.telegram.apiHash || !config.telegram.botToken) {
    logger.warn(
      'TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_BOT_TOKEN nicht vollstaendig gesetzt – ' +
        'Telegram-Uploads sind deaktiviert.',
    );
  }
  if (config.jobs.simulate) {
    logger.info('SIMULATE_JOBS aktiv – Uploads werden simuliert (kein echter Download/Upload).');
  }
}

function shutdown(signal: string): void {
  if (state.shuttingDown) return;
  state.shuttingDown = true;
  logger.info(`${signal} empfangen – fahre herunter...`);
  rssArchiver.stop();
  setTimeout(() => process.exit(0), 500).unref();
}

function main(): void {
  logStartup();
  rssArchiver.start();
  startServer();
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();

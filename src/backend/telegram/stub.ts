import { logger } from '../logger';
import type { TelegramGateway, UploadProgress, VideoMetadata } from './gateway';

/**
 * Platzhalter-Gateway: meldet "nicht verbunden" und wirft bei echten
 * Telegram-Operationen einen aussagekraeftigen Fehler.
 */
export class UnconfiguredTelegramGateway implements TelegramGateway {
  readonly name = 'unconfigured';

  isConnected(): boolean {
    return false;
  }

  getBotUsername(): string {
    return '';
  }

  async createForumTopic(): Promise<number> {
    logger.warn('Telegram ist nicht verbunden (keine Zugangsdaten konfiguriert).');
    throw new Error('Telegram-Client ist noch nicht verbunden.');
  }

  async forwardMessages(): Promise<number[]> {
    logger.warn('Telegram ist nicht verbunden (keine Zugangsdaten konfiguriert).');
    throw new Error('Telegram-Client ist noch nicht verbunden.');
  }

  async deleteMessages(): Promise<void> {
    logger.warn('Telegram ist nicht verbunden (keine Zugangsdaten konfiguriert).');
  }

  async sendVideoToTopic(
    _chatId: number | string,
    _topicId: number,
    _filePath: string,
    _caption: string,
    _meta: VideoMetadata | null,
    _onProgress?: (progress: UploadProgress) => void,
  ): Promise<number> {
    logger.warn('Telegram ist nicht verbunden (keine Zugangsdaten konfiguriert).');
    throw new Error('Telegram-Client ist noch nicht verbunden.');
  }
}

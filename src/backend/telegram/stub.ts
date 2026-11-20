import { logger } from '../logger';
import type { TelegramGateway } from './gateway';

/**
 * Platzhalter-Gateway: meldet "nicht verbunden" und wirft bei echten
 * Telegram-Operationen einen aussagekraeftigen Fehler. Wird ersetzt, sobald
 * die MTProto-Integration (GramJS / @mtproto/core) implementiert ist.
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
    logger.warn('Telegram ist nicht verbunden (Gateway nicht implementiert).');
    throw new Error('Telegram-Client ist noch nicht verbunden.');
  }

  async forwardMessages(): Promise<number[]> {
    logger.warn('Telegram ist nicht verbunden (Gateway nicht implementiert).');
    throw new Error('Telegram-Client ist noch nicht verbunden.');
  }

  async deleteMessages(): Promise<void> {
    logger.warn('Telegram ist nicht verbunden (Gateway nicht implementiert).');
  }
}

import fs from 'node:fs';
import path from 'node:path';
import bigInt from 'big-integer';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { CustomFile } from 'telegram/client/uploads';
import { config } from '../config';
import { logger } from '../logger';
import type {
  TelegramGateway,
  UploadProgress,
  VideoMetadata,
} from './gateway';

function coerceChat(value: number | string): number | string {
  if (typeof value === 'number') return value;
  const text = String(value).trim();
  if (/^-?\d+$/.test(text)) {
    const parsed = Number.parseInt(text, 10);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return text;
}

function randomLong(): ReturnType<typeof bigInt> {
  return bigInt.randBetween(bigInt(1), bigInt('9007199254740991'));
}

function collectMessageIds(
  result: Api.TypeUpdates,
  predicate?: (message: Api.Message) => boolean,
): number[] {
  const updates = (result as { updates?: Api.TypeUpdate[] }).updates ?? [];
  const ids: number[] = [];
  for (const update of updates) {
    if (update instanceof Api.UpdateNewMessage || update instanceof Api.UpdateNewChannelMessage) {
      const message = update.message;
      if (message instanceof Api.Message && (!predicate || predicate(message))) {
        ids.push(message.id);
      }
    }
  }
  return ids;
}

/**
 * Echte MTProto-Implementierung via GramJS.
 *
 * Session wird als StringSession in einer Datei persistiert, damit ein Bot-
 * Login nur beim ersten Start noetig ist.
 */
export class GramJsTelegramGateway implements TelegramGateway {
  readonly name = 'gramjs';
  private client: TelegramClient | null = null;
  private connected = false;
  private botUsername = '';

  isConnected(): boolean {
    return this.connected;
  }

  getBotUsername(): string {
    return this.botUsername;
  }

  private loadSession(): string {
    try {
      return fs.readFileSync(config.paths.telegramSessionFile, 'utf8').trim();
    } catch {
      return '';
    }
  }

  private saveSession(session: string): void {
    try {
      fs.mkdirSync(path.dirname(config.paths.telegramSessionFile), { recursive: true });
      fs.writeFileSync(config.paths.telegramSessionFile, session, { mode: 0o600 });
    } catch (error) {
      logger.warn(`Telegram-Session konnte nicht gespeichert werden: ${String(error)}`);
    }
  }

  async connect(): Promise<void> {
    const { apiId, apiHash, botToken } = config.telegram;
    if (!apiId || !apiHash || !botToken) {
      throw new Error('TELEGRAM_API_ID, TELEGRAM_API_HASH und TELEGRAM_BOT_TOKEN sind erforderlich.');
    }

    const session = new StringSession(this.loadSession());
    const client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 5,
      autoReconnect: true,
      retryDelay: 2000,
      useWSS: false,
    });

    await client.start({ botAuthToken: botToken });
    this.client = client;
    this.saveSession(String(client.session.save()));

    const me = await client.getMe();
    this.botUsername = (me as Api.User).username ?? '';
    this.connected = true;
    logger.info(`Telegram (GramJS) verbunden als @${this.botUsername || '?'}.`);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.client) {
      await this.client.disconnect();
      this.client = null;
    }
  }

  private requireClient(): TelegramClient {
    if (!this.client || !this.connected) {
      throw new Error('Telegram-Client ist noch nicht verbunden.');
    }
    return this.client;
  }

  private async resolve(chatId: number | string): Promise<Api.TypeEntityLike> {
    const client = this.requireClient();
    const peer = coerceChat(chatId);
    try {
      return await client.getInputEntity(peer);
    } catch {
      return peer;
    }
  }

  async createForumTopic(
    forumChatId: number | string,
    title: string,
    iconColor?: number,
  ): Promise<number> {
    const client = this.requireClient();
    const channel = await this.resolve(forumChatId);
    const cleanTitle = String(title ?? '').trim().slice(0, 128) || 'Allgemein';

    const result = await client.invoke(
      new Api.channels.CreateForumTopic({
        channel,
        title: cleanTitle,
        ...(iconColor !== undefined ? { iconColor } : {}),
        randomId: randomLong(),
      }),
    );

    const created = collectMessageIds(
      result,
      (message) => message.action instanceof Api.MessageActionTopicCreate,
    );
    const fallback = created.length ? created : collectMessageIds(result);
    const topicId = fallback[0];
    if (!topicId) {
      throw new Error(`Konnte Topic-ID für '${cleanTitle}' aus Telegram-Antwort nicht ermitteln.`);
    }
    logger.info(`Neues Forum-Topic '${cleanTitle}' erstellt (ID ${topicId}).`);
    return topicId;
  }

  async forwardMessages(
    fromChat: number | string,
    toForumChat: number | string,
    messageIds: number[],
    topicId: number,
    dropAuthor: boolean,
  ): Promise<number[]> {
    if (!messageIds.length) return [];
    const client = this.requireClient();
    const fromPeer = await this.resolve(fromChat);
    const toPeer = await this.resolve(toForumChat);

    const result = await client.invoke(
      new Api.messages.ForwardMessages({
        fromPeer,
        id: messageIds,
        toPeer,
        topMsgId: topicId,
        dropAuthor,
        randomId: messageIds.map(() => randomLong()),
      }),
    );
    return collectMessageIds(result);
  }

  async deleteMessages(chatId: number | string, messageIds: number[]): Promise<void> {
    if (!messageIds.length) return;
    const client = this.requireClient();
    const entity = coerceChat(chatId);
    await client.deleteMessages(entity, messageIds, { revoke: true });
  }

  async sendVideoToTopic(
    chatId: number | string,
    topicId: number,
    filePath: string,
    caption: string,
    meta: VideoMetadata | null,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<number> {
    const client = this.requireClient();
    const entity = coerceChat(chatId);
    const stat = fs.statSync(filePath);

    const attributes: Api.TypeDocumentAttribute[] = [
      new Api.DocumentAttributeFilename({ fileName: path.basename(filePath) }),
    ];
    if (meta && meta.duration > 0 && meta.width > 0 && meta.height > 0) {
      attributes.unshift(
        new Api.DocumentAttributeVideo({
          duration: Math.round(meta.duration),
          w: Math.round(meta.width),
          h: Math.round(meta.height),
          supportsStreaming: true,
        }),
      );
    }

    const message = await client.sendFile(entity, {
      file: new CustomFile(path.basename(filePath), stat.size, filePath),
      caption,
      workers: Math.max(1, config.upload.parallelWorkers),
      forceDocument: !meta,
      supportsStreaming: Boolean(meta),
      topMsgId: topicId,
      attributes,
      progressCallback: (progress: number) => {
        if (!onProgress) return;
        const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
        onProgress({
          uploadedBytes: Math.round(progress * stat.size),
          totalBytes: stat.size,
          pct,
        });
      },
    });

    return message.id;
  }
}

import fs from 'node:fs';
import path from 'node:path';
import bigInt from 'big-integer';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { CustomFile } from 'telegram/client/uploads';
import { NewMessage, type NewMessageEvent } from 'telegram/events';
import { CallbackQuery, type CallbackQueryEvent } from 'telegram/events/CallbackQuery';
import { Button } from 'telegram/tl/custom/button';
import { config } from '../config';
import { logger } from '../logger';
import { settingsStore } from '../settings/store';
import { state } from '../state';
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

type ServiceOrMessage = Api.Message | Api.MessageService;

function collectMessageIds(
  result: Api.TypeUpdates,
  predicate?: (message: ServiceOrMessage) => boolean,
): number[] {
  const updates = (result as { updates?: Api.TypeUpdate[] }).updates ?? [];
  const ids: number[] = [];
  for (const update of updates) {
    if (update instanceof Api.UpdateNewMessage || update instanceof Api.UpdateNewChannelMessage) {
      const message = update.message;
      if (
        (message instanceof Api.Message || message instanceof Api.MessageService) &&
        (!predicate || predicate(message))
      ) {
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
  private authFlowStarted = false;

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
    const { apiId, apiHash, botToken } = settingsStore.get().telegram;
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

  // ---------------------------------------------------------------- Auth-Flow

  startAuthFlow(): void {
    if (this.authFlowStarted) return;
    const client = this.requireClient();

    client.addEventHandler(
      (event: NewMessageEvent) => {
        void this.handleStart(event).catch((error) =>
          logger.error(`Login-Handler (/start) fehlgeschlagen: ${String(error)}`),
        );
      },
      new NewMessage({ pattern: /^\/start(?:\s+login_([A-Za-z0-9_-]+))?/ }),
    );

    client.addEventHandler(
      (event: CallbackQueryEvent) => {
        void this.handleAuthCallback(event).catch((error) =>
          logger.error(`Login-Callback fehlgeschlagen: ${String(error)}`),
        );
      },
      new CallbackQuery({ pattern: /^auth_(ok|no):/ }),
    );

    this.authFlowStarted = true;
    logger.info('Telegram-Login-Flow aktiv (/start + Inline-Buttons).');
  }

  private isAllowedUser(user: Api.User): boolean {
    const allowed = settingsStore.get().telegram.allowedDashboardUsers;
    if (allowed.length === 0) return false;
    const username = (user.username ?? '').toLowerCase();
    const handle = username ? `@${username}` : '';
    const id = String(user.id);
    return allowed.some((entry) => entry === handle || entry === username || entry === id);
  }

  private displayName(user: Api.User): string {
    if (user.username) return `@${user.username}`;
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
    return name || String(user.id);
  }

  private async handleStart(event: NewMessageEvent): Promise<void> {
    if (!event.isPrivate) return;

    const token = event.message.patternMatch?.[1] ?? null;
    const sender = (await event.message.getSender()) as Api.User | undefined;
    if (!sender) return;

    if (!this.isAllowedUser(sender)) {
      logger.warn(`Unbefugter Dashboard-Login-Versuch von ${this.displayName(sender)} (ID ${sender.id}).`);
      await event.message.respond({
        message:
          '⛔ **Zugriff verweigert:** Dein Telegram-Account ist nicht für das VOD-Dashboard freigeschaltet.',
      });
      if (token) {
        const pending = state.pendingAuth.get(token);
        if (pending) pending.status = 'denied';
      }
      return;
    }

    if (!token || !state.pendingAuth.has(token)) {
      await event.message.respond({
        message:
          `👋 Hallo ${this.displayName(sender)}!\n\n` +
          'Ich bin dein VOD-Uploader Bot. Öffne das Dashboard im Browser, um dich anzumelden.',
      });
      return;
    }

    const info = state.pendingAuth.get(token);
    if (!info || info.status !== 'pending') {
      await event.message.respond({
        message: 'Dieser Login-Token wurde bereits verwendet oder ist abgelaufen.',
      });
      return;
    }

    info.user = this.displayName(sender);
    await event.message.respond({
      message:
        '🔐 **Anmeldeversuch für das VOD-Dashboard**\n\n' +
        `Konto: ${info.user}\n\nBestätige oder lehne die Anmeldung ab:`,
      buttons: [
        [
          Button.inline('✅ Anmelden freigeben', Buffer.from(`auth_ok:${token}`)),
          Button.inline('❌ Ablehnen', Buffer.from(`auth_no:${token}`)),
        ],
      ],
    });
    logger.info(`Login-Token für ${info.user} zur Bestätigung gesendet.`);
  }

  private async handleAuthCallback(event: CallbackQueryEvent): Promise<void> {
    const data = event.data?.toString('utf8') ?? '';
    const match = /^auth_(ok|no):(.+)$/.exec(data);
    if (!match) return;
    const kind = match[1] as 'ok' | 'no';
    const token = match[2] ?? '';

    const sender = (await event.getSender()) as Api.User | undefined;
    if (!sender || !this.isAllowedUser(sender)) {
      await event.answer({ message: 'Nicht berechtigt.', alert: true });
      return;
    }

    const info = state.pendingAuth.get(token);
    if (!info || info.status !== 'pending') {
      await event.answer({ message: 'Token abgelaufen oder bereits verwendet.', alert: true });
      return;
    }

    info.status = kind === 'ok' ? 'approved' : 'denied';
    const label = kind === 'ok' ? '✅ Freigegeben' : '❌ Abgelehnt';
    await event.answer({ message: label });

    try {
      await event.edit({
        message: event.messageId,
        text:
          '🔐 **Anmeldeversuch für das VOD-Dashboard**\n\n' +
          `Konto: ${info.user || 'unbekannt'}\n\nStatus: ${label}`,
      });
    } catch (error) {
      logger.debug(`Login-Nachricht konnte nicht editiert werden: ${String(error)}`);
    }

    logger.info(`Login-Token ${kind === 'ok' ? 'freigegeben' : 'abgelehnt'} von ${info.user || sender.id}.`);
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
      (message) =>
        'action' in message && message.action instanceof Api.MessageActionTopicCreate,
    );
    let topicId = (created.length ? created : collectMessageIds(result))[0];

    // Service-Messages / Updates koennen fehlen: nach kurzer Wartezeit ueber
    // die Themenliste nachschlagen.
    if (!topicId) {
      for (let attempt = 0; attempt < 3 && !topicId; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 800 : 1500));
        topicId = (await this.lookupForumTopic(channel, cleanTitle)) ?? undefined;
      }
    }

    if (!topicId) {
      throw new Error(`Konnte Topic-ID für '${cleanTitle}' aus Telegram-Antwort nicht ermitteln.`);
    }
    logger.info(`Neues Forum-Topic '${cleanTitle}' erstellt (ID ${topicId}).`);
    return topicId;
  }

  /** Sucht ein Forum-Topic anhand seines Titels (Fallback nach dem Anlegen). */
  private async lookupForumTopic(
    channel: Api.TypeEntityLike,
    title: string,
  ): Promise<number | null> {
    const client = this.requireClient();
    const result = await client.invoke(
      new Api.channels.GetForumTopics({
        channel,
        q: title,
        offsetDate: 0,
        offsetId: 0,
        offsetTopic: 0,
        limit: 100,
      }),
    );
    const topics = (result as { topics?: Api.TypeForumTopic[] }).topics ?? [];
    const wanted = title.trim().toLowerCase();
    for (const topic of topics) {
      if ('title' in topic && String(topic.title).trim().toLowerCase() === wanted) {
        return topic.id;
      }
    }
    const messages = (result as { messages?: Api.TypeMessage[] }).messages ?? [];
    for (const message of messages) {
      if (message instanceof Api.MessageService || message instanceof Api.Message) {
        if (
          'action' in message &&
          message.action instanceof Api.MessageActionTopicCreate &&
          message.action.title.trim().toLowerCase() === wanted
        ) {
          return message.id;
        }
      }
    }
    return null;
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
      workers: Math.max(1, settingsStore.get().jobs.parallelWorkers),
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

  async findForumTopicByTitle(chatId: number | string, title: string): Promise<number | null> {
    const channel = await this.resolve(chatId);
    return this.lookupForumTopic(channel, title);
  }

  async sendMessage(chatId: number | string, text: string): Promise<void> {
    const client = this.requireClient();
    await client.sendMessage(coerceChat(chatId), { message: text });
  }
}

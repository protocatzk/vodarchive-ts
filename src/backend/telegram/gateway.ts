/**
 * Abstraktion fuer den Telegram-Zugriff.
 *
 * Die urspruengliche Python-Implementierung nutzt Telethon (MTProto). Eine
 * 1:1-Portierung nach Node.js ist ein eigener, grosser Schritt (z. B. via
 * GramJS oder @mtproto/core). Bis dahin kapselt dieses Interface alle
 * Telegram-Operationen, damit API/UI bereits lauffaehig sind und die echte
 * Implementierung spaeter nur hier eingesetzt werden muss.
 */
export interface TelegramGateway {
  readonly name: string;
  isConnected(): boolean;
  getBotUsername(): string;
  createForumTopic(forumChatId: number | string, title: string, iconColor?: number): Promise<number>;
  forwardMessages(
    fromChat: number | string,
    toForumChat: number | string,
    messageIds: number[],
    topicId: number,
    dropAuthor: boolean,
  ): Promise<number[]>;
  deleteMessages(chatId: number | string, messageIds: number[]): Promise<void>;
}

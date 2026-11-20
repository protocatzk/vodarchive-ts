/**
 * Abstraktion fuer den Telegram-Zugriff.
 *
 * Implementierungen: GramJS (echtes MTProto) und ein Platzhalter, der genutzt
 * wird, wenn keine Zugangsdaten konfiguriert sind. API/UI haengen nur von
 * diesem Interface ab.
 */
export interface UploadProgress {
  uploadedBytes: number;
  totalBytes: number;
  pct: number;
}

export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
}

export interface TelegramGateway {
  readonly name: string;
  connect?(): Promise<void>;
  disconnect?(): Promise<void>;
  /** Registriert /start- und Callback-Handler fuer die Dashboard-Anmeldung. */
  startAuthFlow?(): void;
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
  sendVideoToTopic(
    chatId: number | string,
    topicId: number,
    filePath: string,
    caption: string,
    meta: VideoMetadata | null,
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<number>;
  /** Einfache Textnachricht (z. B. Workflow-Benachrichtigung). */
  sendMessage?(chatId: number | string, text: string): Promise<void>;
  /** Sucht ein bestehendes Forum-Topic anhand des Titels. */
  findForumTopicByTitle?(chatId: number | string, title: string): Promise<number | null>;
}

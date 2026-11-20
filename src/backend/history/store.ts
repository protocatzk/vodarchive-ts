import path from 'node:path';
import { config } from '../config';
import { logger } from '../logger';
import { readJsonFile, writeJsonFileAtomic } from '../util/json';

export interface HistoryItem {
  finished_at: string;
  streamer: string;
  title: string;
  parts: number;
  total_size_mb: number | string;
  topic_id: number | null;
  topic_name: string;
  status: 'success' | 'failed' | 'cancelled';
}

const MAX_ENTRIES = 500;

export class HistoryStore {
  readonly file: string;
  private data: HistoryItem[];

  constructor(file = path.join(config.paths.baseDir, 'history.json')) {
    this.file = file;
    this.data = readJsonFile<HistoryItem[]>(file, []).filter(
      (entry) => entry && typeof entry === 'object' && 'status' in entry,
    );
    if (this.data.length > MAX_ENTRIES) {
      this.data = this.data.slice(0, MAX_ENTRIES);
      this.persist();
    }
  }

  private persist(): void {
    try {
      writeJsonFileAtomic(this.file, this.data, 0o600);
    } catch (error) {
      logger.warn(`Job-History konnte nicht gespeichert werden: ${String(error)}`);
    }
  }

  list(limit = 100): HistoryItem[] {
    return this.data.slice(0, Math.max(1, limit));
  }

  add(item: HistoryItem): void {
    this.data.unshift(item);
    if (this.data.length > MAX_ENTRIES) this.data.length = MAX_ENTRIES;
    this.persist();
  }

  clear(): number {
    const removed = this.data.length;
    this.data = [];
    this.persist();
    return removed;
  }
}

export const historyStore = new HistoryStore();

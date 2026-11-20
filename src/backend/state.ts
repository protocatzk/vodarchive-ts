import { config } from './config';
import { historyStore, type HistoryItem } from './history/store';
import { JobStore } from './jobs/job_store';
import { logger } from './logger';
import { topicManager } from './topic/manager';
import { UnconfiguredTelegramGateway } from './telegram/stub';
import type { TelegramGateway } from './telegram/gateway';

export type { HistoryItem };

export type PendingAuthStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface PendingAuth {
  status: PendingAuthStatus;
  created_at: number;
  user: string;
}

export interface Session {
  user: string;
  expires_at: number;
}

export interface ActiveJob {
  key: string;
  job_id: string;
  streamer: string;
  title: string;
  stage: string;
  stage_label: string;
  pct: number;
  bytes_done: number;
  bytes_total: number;
  speed_mbps: number;
  eta_seconds: number;
}

export interface QueueItem {
  key: string;
  job_id: string;
  streamer: string;
  title: string;
  source: string;
}

export interface JobOutcome {
  status: 'success' | 'cancelled' | 'failed';
  error?: string;
  topicId?: number;
  topicName?: string;
  parts?: number;
  totalSizeMb?: number;
}

class RuntimeState {
  readonly startedAt = Date.now();
  gateway: TelegramGateway = new UnconfiguredTelegramGateway();
  botUsername = '';

  activeJob: ActiveJob | null = null;
  waitingQueue: QueueItem[] = [];
  history: HistoryItem[] = historyStore.list(100);

  sessions = new Map<string, Session>();
  pendingAuth = new Map<string, PendingAuth>();
  cancelledJobs = new Set<string>();
  n8nLastTrigger: Record<string, number> = {};
  jobWaiters = new Map<string, (outcome: JobOutcome) => void>();

  shuttingDown = false;
  processing = false;

  readonly jobStore = new JobStore(
    config.paths.baseDir,
    config.jobs.doneTtlDays,
    config.jobs.staleDays,
    config.jobs.failedTtlDays,
  );

  setGateway(gateway: TelegramGateway): void {
    this.gateway = gateway;
    this.botUsername = gateway.getBotUsername();
  }

  mappedTopicCount(): number {
    const ids = new Set<number>();
    for (const chatTopics of Object.values(topicManager.cache)) {
      if (!chatTopics || typeof chatTopics !== 'object') continue;
      for (const tid of Object.values(chatTopics)) {
        if (typeof tid === 'number' && Number.isInteger(tid)) ids.add(tid);
      }
    }
    return ids.size;
  }

  addQueueItem(item: QueueItem): void {
    if (!this.waitingQueue.some((entry) => entry.key === item.key)) {
      this.waitingQueue.push(item);
    }
  }

  removeQueueItem(key: string): QueueItem | null {
    const index = this.waitingQueue.findIndex((entry) => entry.key === key);
    if (index === -1) return null;
    const [removed] = this.waitingQueue.splice(index, 1);
    return removed ?? null;
  }

  addHistory(item: HistoryItem): void {
    this.history.unshift(item);
    if (this.history.length > 100) this.history.length = 100;
    historyStore.add(item);
  }

  clearHistory(): number {
    const removed = historyStore.clear();
    this.history = [];
    return removed;
  }

  isCancelled(key: string): boolean {
    return this.cancelledJobs.has(key);
  }

  resolveJob(key: string, outcome: JobOutcome): void {
    const waiter = this.jobWaiters.get(key);
    if (waiter) {
      this.jobWaiters.delete(key);
      waiter(outcome);
    }
  }

  requestCancel(key: string): 'cancelled' | 'cancelling' | 'not_found' {
    const inQueue = this.waitingQueue.some((entry) => entry.key === key);
    if (inQueue) {
      this.removeQueueItem(key);
      this.cancelledJobs.add(key);
      this.jobStore.remove(key);
      logger.info(`[${key}] Wartender Job abgebrochen.`);
      return 'cancelled';
    }
    if (this.activeJob && this.activeJob.key === key) {
      this.cancelledJobs.add(key);
      logger.info(`[${key}] Aktiver Job wird abgebrochen...`);
      return 'cancelling';
    }
    const record = this.jobStore.get(key);
    if (record) {
      this.cancelledJobs.add(key);
      this.jobStore.fail(key, 'cancelled');
      this.jobStore.remove(key);
      return 'cancelled';
    }
    return 'not_found';
  }

  snapshotBase(): {
    user: string;
    queue_count: number;
    topic_count: number;
    active_job: ActiveJob | null;
    queue: QueueItem[];
    history: HistoryItem[];
    logs: ReturnType<typeof logger.buffer>;
  } {
    return {
      user: '',
      queue_count: this.waitingQueue.length,
      topic_count: this.mappedTopicCount(),
      active_job: this.activeJob,
      queue: [...this.waitingQueue],
      history: [...this.history],
      logs: logger.buffer(),
    };
  }
}

export const state = new RuntimeState();

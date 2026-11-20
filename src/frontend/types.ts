export interface LogLine {
  time: string;
  level: 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG';
  message: string;
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

export interface RssFeed {
  title: string;
  bundle: boolean;
  child_count: number;
  host: string;
  last_check: number | null;
  ok: boolean | null;
  error: string | null;
  items: number;
}

export interface RssCounts {
  archived: number;
  skipped: number;
  failed: number;
  retry: number;
  live: number;
  baseline: number;
}

export interface RssStatus {
  enabled: boolean;
  running: boolean;
  polling: boolean;
  processing: boolean;
  queue: number;
  blocked_until: number;
  cookies?: { broken?: boolean; reason?: string; exists?: boolean; path?: string | null };
  interval_seconds: number;
  feeds: RssFeed[];
  counts: RssCounts;
  last_poll_finished: number | null;
  last_error: string | null;
}

export interface Snapshot {
  user: string;
  queue_count: number;
  topic_count: number;
  active_job: ActiveJob | null;
  queue: QueueItem[];
  history: HistoryItem[];
  logs: LogLine[];
  rss: RssStatus;
  n8n_workflows: string[];
}

export interface TopicRow {
  topic_id: number;
  name: string;
  aliases: string[];
  link: string;
}

export interface TopicsPayload {
  chat_id: string;
  chats: string[];
  forum_chat_id: string;
  topics: TopicRow[];
  alias_count: number;
}

export interface MaskedSettings {
  telegram: {
    apiId: number;
    apiHash: string;
    botToken: string;
    chatId: string;
    forumChatId: string;
    forwardDropAuthor: boolean;
    allowedDashboardUsers: string[];
  };
  jobs: {
    simulate: boolean;
    parallelWorkers: number;
    keepFiles: boolean;
    doneTtlDays: number;
    staleDays: number;
    failedTtlDays: number;
  };
  upload: {
    splitThresholdBytes: number;
    targetPartSizeBytes: number;
  };
  rss: {
    enabled: boolean;
    pollIntervalSeconds: number;
    initialBackfill: boolean;
    maxItemAgeHours: number;
    maxItemsPerPoll: number;
    allowLive: boolean;
    topicPerFeed: boolean;
    archiveChatId: string;
    archiveForumChatId: string;
    maxRetries: number;
  };
  n8n: {
    timeoutSeconds: number;
    triggerCooldownSeconds: number;
    apiBaseUrl: string;
    apiKey: string;
  };
  secrets: {
    telegramApiHash: boolean;
    telegramBotToken: boolean;
    n8nApiKey: boolean;
  };
}

export type SourceType = 'rss' | 'opml' | 'ytdlp' | 'streamrecorder';

export interface Source {
  id: string;
  name: string;
  type: SourceType;
  url: string;
  enabled: boolean;
  pollIntervalSeconds: number | null;
  createdAt: string;
  lastCheck: number | null;
  lastOk: boolean | null;
  lastError: string | null;
  lastItems: number;
  archivedCount: number;
  cookieSet?: boolean;
  apiBaseUrl?: string;
  listPath?: string;
  limit?: number;
  itemsPath?: string;
  targets?: string[];
  fieldMap?: Record<string, string>;
  initialBackfill?: boolean;
  onlyNew?: boolean;
  dryRun?: boolean;
  testMode?: boolean;
  testChatId?: string;
  testForumChatId?: string;
}

export type WorkflowStatus = 'ok' | 'failed' | 'timeout' | 'cooldown';

export type WorkflowKind = 'webhook' | 'internal';

export interface WorkflowStep {
  id?: string;
  type: string;
  name?: string;
  continueOnError?: boolean;
  [key: string]: unknown;
}

export interface WorkflowDefinition {
  trigger: { type: 'manual' | 'schedule'; intervalSeconds?: number };
  steps: WorkflowStep[];
}

export interface Workflow {
  id: string;
  name: string;
  kind: WorkflowKind;
  webhookUrl: string;
  definition?: WorkflowDefinition;
  enabled: boolean;
  intervalSeconds: number;
  createdAt: string;
  lastRun: number | null;
  lastStatus: WorkflowStatus | null;
  lastHttpStatus: number | null;
  lastError: string | null;
  runCount: number;
}

export interface ExecutionStepLog {
  id: string;
  type: string;
  name?: string;
  status: 'ok' | 'error' | 'skipped';
  startedAt: number;
  finishedAt: number;
  error?: string;
  output?: unknown;
}

export interface ExecutionRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  trigger: string;
  startedAt: number;
  finishedAt: number | null;
  status: 'running' | 'success' | 'failed';
  error?: string;
  steps: ExecutionStepLog[];
}

export interface N8nDiscoveredWorkflow {
  id: string;
  name: string;
  active: boolean;
  webhookPath: string | null;
  webhookUrl: string | null;
  updatedAt: string | null;
  tags: string[];
}


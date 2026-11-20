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

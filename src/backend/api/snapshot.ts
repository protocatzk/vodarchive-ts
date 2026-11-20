import { config } from '../config';
import { rssArchiver } from '../rss/archiver';
import { state } from '../state';

export function buildSnapshot(user: string): Record<string, unknown> {
  return {
    ...state.snapshotBase(),
    user,
    rss: rssArchiver.status(),
    n8n_workflows: Object.keys(config.n8n.webhooks).sort(),
  };
}

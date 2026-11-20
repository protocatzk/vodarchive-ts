import { config } from '../config';
import { rssArchiver } from '../rss/archiver';
import { state } from '../state';
import { workflowStore } from '../workflows/store';

export function buildSnapshot(user: string): Record<string, unknown> {
  return {
    ...state.snapshotBase(),
    user,
    rss: rssArchiver.status(),
    n8n_workflows: workflowStore.enabledNames().sort(),
  };
}

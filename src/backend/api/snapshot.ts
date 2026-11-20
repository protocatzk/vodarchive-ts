import { config } from '../config';
import { rssArchiver } from '../rss/archiver';
import { sourceStore } from '../sources/store';
import { state } from '../state';
import { executionStore } from '../workflows/executions';
import { workflowStore } from '../workflows/store';

export function buildSnapshot(user: string): Record<string, unknown> {
  const workflows = workflowStore.list().map((workflow) => ({
    id: workflow.id,
    name: workflow.name,
    kind: workflow.kind,
    enabled: workflow.enabled,
    intervalSeconds: workflow.intervalSeconds,
    createdAt: workflow.createdAt,
    lastRun: workflow.lastRun,
    lastStatus: workflow.lastStatus,
    lastHttpStatus: workflow.lastHttpStatus,
    lastError: workflow.lastError,
    runCount: workflow.runCount,
    trigger: workflow.definition?.trigger ?? null,
  }));

  return {
    ...state.snapshotBase(),
    user,
    rss: rssArchiver.status(),
    n8n_workflows: workflowStore.enabledNames().sort(),
    sources: sourceStore.list(),
    workflows,
    executions: executionStore.list(10),
  };
}

import { logger } from '../logger';
import { settingsStore } from '../settings/store';
import { executionStore } from './executions';
import { runInternalWorkflow } from './engine';
import { workflowStore, type Workflow, type WorkflowStatus } from './store';

export interface TriggerOutcome {
  status: WorkflowStatus;
  httpStatus?: number;
  error?: string;
}

const running = new Set<string>();

export async function runWorkflow(
  workflow: Workflow,
  options: { force?: boolean } = {},
): Promise<TriggerOutcome> {
  if (running.has(workflow.id)) {
    return { status: 'cooldown', error: 'Workflow läuft bereits.' };
  }

  const n8n = settingsStore.get().n8n;
  const now = Math.floor(Date.now() / 1000);
  if (
    !options.force &&
    n8n.triggerCooldownSeconds > 0 &&
    workflow.lastRun !== null &&
    now - workflow.lastRun < n8n.triggerCooldownSeconds
  ) {
    return { status: 'cooldown' };
  }

  running.add(workflow.id);
  const nowAtStart = Math.floor(Date.now() / 1000);

  if (workflow.kind === 'internal') {
    try {
      const result = await runInternalWorkflow(
        workflow,
        options.force ? 'manual' : 'schedule',
      );
      workflowStore.markRun(workflow.id, {
        status: result.status === 'ok' ? 'ok' : 'failed',
        error: result.error ?? null,
        at: nowAtStart,
      });
      return result.status === 'ok'
        ? { status: 'ok' }
        : { status: 'failed', error: result.error };
    } finally {
      running.delete(workflow.id);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, n8n.timeoutSeconds) * 1000);

  try {
    const response = await fetch(workflow.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'vodarchive',
        workflow: workflow.name,
        timestamp: now,
      }),
      signal: controller.signal,
    });
    const body = await response.text().catch(() => '');
    const ok = response.status < 400;
    const status: WorkflowStatus = ok ? 'ok' : 'failed';
    workflowStore.markRun(workflow.id, {
      status,
      httpStatus: response.status,
      error: ok ? null : `HTTP ${response.status}: ${body.slice(0, 200)}`,
      at: now,
    });
    logger.info(`n8n-Workflow '${workflow.name}' ausgeführt (HTTP ${response.status}).`);
    return { status, httpStatus: response.status };
  } catch (error) {
    const aborted = (error as Error).name === 'AbortError';
    const status: WorkflowStatus = aborted ? 'timeout' : 'failed';
    const message = aborted
      ? `Timeout nach ${n8n.timeoutSeconds}s`
      : (error as Error).message;
    workflowStore.markRun(workflow.id, { status, error: message, at: now });
    logger.warn(`n8n-Workflow '${workflow.name}' fehlgeschlagen: ${message}`);
    return { status, error: message };
  } finally {
    clearTimeout(timer);
    running.delete(workflow.id);
  }
}

let schedulerTimer: NodeJS.Timeout | null = null;

export function startWorkflowScheduler(): void {
  if (schedulerTimer) return;

  const tick = (): void => {
    const now = Math.floor(Date.now() / 1000);
    for (const workflow of workflowStore.due(now)) {
      void runWorkflow(workflow).catch((error) =>
        logger.error(`Scheduler-Fehler bei '${workflow.name}': ${String(error)}`),
      );
    }
  };

  schedulerTimer = setInterval(tick, 15000);
  schedulerTimer.unref?.();
  const initial = setTimeout(tick, 5000);
  initial.unref?.();
  logger.info('n8n-Workflow-Scheduler aktiv (Prüfung alle 15s).');
}

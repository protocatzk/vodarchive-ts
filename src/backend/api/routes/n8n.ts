import { Router, type Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { N8nApiClient } from '../../n8n/client';
import { runWorkflow } from '../../workflows/runner';
import { workflowStore } from '../../workflows/store';

export const n8nRouter = Router();

interface WorkflowResult {
  name: string;
  ok: boolean;
  status?: string;
  http_status?: number;
  response?: string;
}

n8nRouter.post('/run', requireAuth, async (req, res) => {
  const requested = String(req.query['name'] ?? '').trim();
  const all = workflowStore.list();
  const enabled = all.filter((workflow) => workflow.enabled);

  if (all.length === 0) {
    res.status(503).json({ status: 'disabled' });
    return;
  }

  let targets = requested ? enabled.filter((workflow) => workflow.name === requested) : enabled;
  if (requested && targets.length === 0) {
    res.status(404).json({
      error: 'Unknown workflow',
      available: enabled.map((workflow) => workflow.name).sort(),
    });
    return;
  }
  targets = [...targets];

  const results: WorkflowResult[] = [];
  for (const workflow of targets) {
    const outcome = await runWorkflow(workflow, { force: true });
    results.push({
      name: workflow.name,
      ok: outcome.status === 'ok',
      status: outcome.status,
      ...(outcome.httpStatus !== undefined ? { http_status: outcome.httpStatus } : {}),
      ...(outcome.error ? { response: outcome.error } : {}),
    });
  }

  const started = results.filter((result) => result.ok);
  if (started.length === 0) {
    const allCooldown = results.every((result) => result.status === 'cooldown');
    res.status(allCooldown ? 429 : 502).json({ status: 'failed', workflows: results });
    return;
  }
  res.status(202).json({ status: 'started', workflows: results });
});

// ---------------------------------------------------------------- n8n-API

n8nRouter.get('/status', requireAuth, async (_req, res) => {
  const client = N8nApiClient.fromSettings();
  if (!client) {
    res.json({ configured: false });
    return;
  }
  const test = await client.test();
  res.json({ configured: true, ...test });
});

n8nRouter.get('/discover', requireAuth, async (_req, res) => {
  const client = N8nApiClient.fromSettings();
  if (!client) {
    res.status(503).json({ error: 'n8n API nicht konfiguriert (Base URL + API-Key in den Einstellungen).' });
    return;
  }
  try {
    const workflows = await client.listWorkflows();
    res.json({ workflows });
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

n8nRouter.post('/discover/:id/activate', requireAuth, async (req, res) => {
  await setN8nActive(req.params['id'] ?? '', true, res);
});

n8nRouter.post('/discover/:id/deactivate', requireAuth, async (req, res) => {
  await setN8nActive(req.params['id'] ?? '', false, res);
});

async function setN8nActive(id: string, active: boolean, res: Response): Promise<void> {
  const client = N8nApiClient.fromSettings();
  if (!client) {
    res.status(503).json({ error: 'n8n API nicht konfiguriert.' });
    return;
  }
  try {
    await client.setActive(id, active);
    res.json({ status: 'ok', active });
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
}

function importDiscovered(
  summary: { name: string; webhookUrl: string | null },
  intervalSeconds: number,
): { workflow: ReturnType<typeof workflowStore.add>; imported: boolean } {
  const existing = workflowStore
    .list()
    .find(
      (workflow) =>
        workflow.name === summary.name ||
        (summary.webhookUrl !== null && workflow.webhookUrl === summary.webhookUrl),
    );
  if (existing) return { workflow: existing, imported: false };
  if (!summary.webhookUrl) {
    throw new Error('Workflow hat keinen Webhook-Trigger und kann nicht importiert werden.');
  }
  return {
    workflow: workflowStore.add({
      name: summary.name,
      webhookUrl: summary.webhookUrl,
      intervalSeconds,
    }),
    imported: true,
  };
}

n8nRouter.post('/import/:id', requireAuth, async (req, res) => {
  const client = N8nApiClient.fromSettings();
  if (!client) {
    res.status(503).json({ error: 'n8n API nicht konfiguriert.' });
    return;
  }
  try {
    const workflows = await client.listWorkflows();
    const summary = workflows.find((workflow) => workflow.id === req.params['id']);
    if (!summary) {
      res.status(404).json({ error: 'Workflow bei n8n nicht gefunden.' });
      return;
    }
    const intervalSeconds = Number((req.body as Record<string, unknown>)?.['intervalSeconds'] ?? 0) || 0;
    const result = importDiscovered(summary, intervalSeconds);
    res.status(result.imported ? 201 : 200).json({
      status: 'ok',
      imported: result.imported,
      workflow: result.workflow,
    });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

n8nRouter.post('/import', requireAuth, async (req, res) => {
  const client = N8nApiClient.fromSettings();
  if (!client) {
    res.status(503).json({ error: 'n8n API nicht konfiguriert.' });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const ids = Array.isArray(body['ids']) ? body['ids'].map((id) => String(id)) : [];
  const intervalSeconds = Number(body['intervalSeconds'] ?? 0) || 0;
  if (ids.length === 0) {
    res.status(400).json({ error: 'ids erwartet.' });
    return;
  }
  try {
    const workflows = await client.listWorkflows();
    const results: Array<{ id: string; imported: boolean; name?: string; error?: string }> = [];
    for (const id of ids) {
      const summary = workflows.find((workflow) => workflow.id === id);
      if (!summary) {
        results.push({ id, imported: false, error: 'nicht gefunden' });
        continue;
      }
      try {
        const result = importDiscovered(summary, intervalSeconds);
        results.push({ id, imported: result.imported, name: result.workflow.name });
      } catch (error) {
        results.push({ id, imported: false, name: summary.name, error: (error as Error).message });
      }
    }
    res.json({ status: 'ok', results });
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});


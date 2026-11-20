import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
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

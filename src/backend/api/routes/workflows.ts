import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { runWorkflow } from '../../workflows/runner';
import { workflowStore } from '../../workflows/store';

export const workflowsRouter = Router();
workflowsRouter.use(requireAuth);

workflowsRouter.get('/', (_req, res) => {
  res.json({ workflows: workflowStore.list() });
});

workflowsRouter.post('/', (req, res) => {
  try {
    const workflow = workflowStore.add((req.body ?? {}) as Record<string, unknown>);
    res.status(201).json({ status: 'ok', workflow });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

workflowsRouter.patch('/:id', (req, res) => {
  try {
    const workflow = workflowStore.update(
      req.params['id'] ?? '',
      (req.body ?? {}) as Record<string, unknown>,
    );
    res.json({ status: 'ok', workflow });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

workflowsRouter.delete('/:id', (req, res) => {
  if (!workflowStore.remove(req.params['id'] ?? '')) {
    res.status(404).json({ error: 'Workflow nicht gefunden.' });
    return;
  }
  res.json({ status: 'ok' });
});

workflowsRouter.post('/:id/run', async (req, res) => {
  const workflow = workflowStore.get(req.params['id'] ?? '');
  if (!workflow) {
    res.status(404).json({ error: 'Workflow nicht gefunden.' });
    return;
  }
  const outcome = await runWorkflow(workflow, { force: true });
  const ok = outcome.status === 'ok';
  res.status(ok ? 202 : outcome.status === 'cooldown' ? 429 : 502).json({
    status: outcome.status,
    ...(outcome.httpStatus !== undefined ? { http_status: outcome.httpStatus } : {}),
    ...(outcome.error ? { error: outcome.error } : {}),
  });
});

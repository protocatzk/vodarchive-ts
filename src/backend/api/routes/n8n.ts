import { Router } from 'express';
import { config } from '../../config';
import { logger } from '../../logger';
import { state } from '../../state';
import { requireAuth } from '../middleware/auth';

export const n8nRouter = Router();

interface WorkflowResult {
  name: string;
  ok: boolean;
  status?: string;
  http_status?: number;
  response?: string;
}

n8nRouter.post('/run', requireAuth, async (req, res) => {
  const webhooks = config.n8n.webhooks;
  const names = Object.keys(webhooks);
  if (names.length === 0) {
    res.status(503).json({ status: 'disabled' });
    return;
  }

  const requested = String(req.query['name'] ?? '').trim();
  if (requested && !(requested in webhooks)) {
    res.status(404).json({ error: 'Unknown workflow', available: names.sort() });
    return;
  }

  const targets = requested ? [requested] : names;
  const now = Date.now() / 1000;
  const results: WorkflowResult[] = [];

  for (const target of targets) {
    const url = webhooks[target];
    if (!url) continue;
    const last = state.n8nLastTrigger[target] ?? 0;
    if (config.n8n.triggerCooldownSeconds && now - last < config.n8n.triggerCooldownSeconds) {
      results.push({ name: target, ok: false, status: 'cooldown' });
      continue;
    }
    state.n8nLastTrigger[target] = now;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.n8n.timeoutSeconds * 1000);
    try {
      const response = await fetch(url, { method: 'POST', signal: controller.signal });
      const body = await response.text();
      const ok = response.status < 400;
      logger.info(`n8n-Workflow '${target}' gestartet (HTTP ${response.status})`);
      results.push({
        name: target,
        ok,
        http_status: response.status,
        response: body.slice(0, 200),
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        logger.warn(`n8n-Workflow '${target}': Timeout nach ${config.n8n.timeoutSeconds}s`);
        results.push({ name: target, ok: false, status: 'timeout' });
      } else {
        logger.warn(`n8n-Workflow '${target}' fehlgeschlagen: ${String(error)}`);
        results.push({ name: target, ok: false, status: 'error' });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  const started = results.filter((result) => result.ok);
  if (started.length === 0) {
    const allCooldown = results.every((result) => result.status === 'cooldown');
    res.status(allCooldown ? 429 : 502).json({ status: 'failed', workflows: results });
    return;
  }
  res.status(202).json({ status: 'started', workflows: results });
});

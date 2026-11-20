import { logger } from '../logger';
import { settingsStore } from '../settings/store';
import { sourceStore } from '../sources/store';
import { fetchStreamrecorder } from '../sources/streamrecorder';
import { enqueueJob } from '../jobs/worker';
import { state } from '../state';
import { executionStore } from './executions';
import type { Workflow, WorkflowDefinition, WorkflowStep } from './store';

export interface WorkflowResult {
  status: 'ok' | 'failed';
  error?: string;
}

interface StepContext {
  vars: Record<string, unknown>;
  items: unknown[];
  item: unknown;
  last: unknown;
  workflow: Workflow;
  executionId: string;
}

function getPath(root: unknown, path: string): unknown {
  if (!path) return root;
  let current = root;
  for (const part of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(part);
      current = Number.isInteger(index) ? current[index] : undefined;
      continue;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
      continue;
    }
    return undefined;
  }
  return current;
}

function resolveExpression(expression: string, ctx: StepContext): unknown {
  const expr = expression.trim();
  if (!expr) return '';
  if (expr.startsWith('env.')) return process.env[expr.slice(4)] ?? '';
  if (expr === 'execution.id') return ctx.executionId;
  if (expr === 'items') return ctx.items;
  if (expr === 'last') return ctx.last;
  if (expr === 'item') return ctx.item;
  if (expr.startsWith('vars.')) return getPath(ctx.vars, expr.slice(5));
  if (expr.startsWith('workflow.')) return getPath(ctx.workflow, expr.slice(9));
  if (expr.startsWith('item.')) return getPath(ctx.item, expr.slice(5));
  if (expr.startsWith('last.')) return getPath(ctx.last, expr.slice(5));
  if (expr.startsWith('vars[')) return getPath(ctx.vars, expr.slice(5, -1).replace(/['"]/g, ''));
  return getPath(ctx, expr);
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function resolveString(value: string, ctx: StepContext): unknown {
  const single = /^\s*\{\{\s*([\s\S]+?)\s*\}\}\s*$/.exec(value);
  if (single) return resolveExpression(single[1] ?? '', ctx);
  return value.replace(/\{\{\s*([\s\S]+?)\s*\}\}/g, (_match, expr: string) =>
    stringify(resolveExpression(expr, ctx)),
  );
}

function resolveValue(value: unknown, ctx: StepContext): unknown {
  if (typeof value === 'string') return resolveString(value, ctx);
  if (Array.isArray(value)) return value.map((entry) => resolveValue(entry, ctx));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = resolveValue(entry, ctx);
    }
    return out;
  }
  return value;
}

function compare(left: unknown, op: string, right: unknown): boolean {
  const opLower = op.toLowerCase();
  if (opLower === 'exists') return left !== undefined && left !== null;
  if (opLower === 'truthy') return Boolean(left);
  if (opLower === 'falsy') return !left;

  const leftNum = typeof left === 'number' ? left : Number(left);
  const rightNum = typeof right === 'number' ? right : Number(right);
  const numeric = Number.isFinite(leftNum) && Number.isFinite(rightNum) && left !== '' && right !== '';

  switch (opLower) {
    case 'eq':
      return String(left) === String(right);
    case 'neq':
      return String(left) !== String(right);
    case 'gt':
      return numeric ? leftNum > rightNum : String(left) > String(right);
    case 'gte':
      return numeric ? leftNum >= rightNum : String(left) >= String(right);
    case 'lt':
      return numeric ? leftNum < rightNum : String(left) < String(right);
    case 'lte':
      return numeric ? leftNum <= rightNum : String(left) <= String(right);
    case 'contains':
      return Array.isArray(left)
        ? left.map(String).some((entry) => entry.toLowerCase().includes(String(right).toLowerCase()))
        : String(left ?? '').toLowerCase().includes(String(right ?? '').toLowerCase());
    case 'notcontains':
      return !compare(left, 'contains', right);
    case 'in':
      return Array.isArray(right) ? right.map(String).includes(String(left)) : false;
    case 'regex':
      try {
        return new RegExp(String(right)).test(String(left ?? ''));
      } catch {
        return false;
      }
    default:
      throw new Error(`Unbekannter Vergleich: ${op}`);
  }
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(300, seconds)) * 1000));
}

async function runHttpStep(step: WorkflowStep, ctx: StepContext): Promise<unknown> {
  const method = String(step['method'] ?? 'GET').toUpperCase();
  let url = String(resolveValue(step['url'] ?? '', ctx));
  if (!/^https?:\/\//i.test(url)) throw new Error(`Ungültige URL: ${url}`);

  const query = resolveValue(step['query'] ?? {}, ctx) as Record<string, unknown>;
  if (query && typeof query === 'object') {
    const parsed = new URL(url);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      parsed.searchParams.set(key, String(value));
    }
    url = parsed.toString();
  }

  const headers = (resolveValue(step['headers'] ?? {}, ctx) as Record<string, unknown>) ?? {};
  const bodyRaw = resolveValue(step['body'], ctx);
  const body = bodyRaw === undefined ? undefined : typeof bodyRaw === 'string' ? bodyRaw : JSON.stringify(bodyRaw);
  const responseType = String(step['responseType'] ?? 'json');
  const timeoutSeconds = Math.min(300, Number(step['timeoutSeconds'] ?? 30) || 30);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(headers as Record<string, string>),
      },
      ...(body !== undefined ? { body } : {}),
    });
    const text = await response.text();
    if (step['expectOk'] !== false && !response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    let data: unknown = text;
    if (responseType === 'json') {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    ctx.last = data;
    if (step['saveAs']) ctx.vars[String(step['saveAs'])] = data;
    if (step['asItems'] && Array.isArray(data)) ctx.items = data;
    return { status: response.status, ...(step['saveAs'] ? { savedAs: step['saveAs'] } : {}) };
  } finally {
    clearTimeout(timer);
  }
}

async function runStreamrecorderStep(step: WorkflowStep, ctx: StepContext): Promise<unknown> {
  const sourceId = String(step['sourceId'] ?? '').trim();
  if (!sourceId) throw new Error('streamrecorder: sourceId fehlt.');
  const source = sourceStore.getInternal(sourceId);
  if (!source) throw new Error(`streamrecorder: Quelle ${sourceId} nicht gefunden.`);
  const result = await fetchStreamrecorder(source);
  const items = result.items.map((item) => ({
    id: item.id,
    recordingId: item.recordingId,
    title: item.title,
    streamer: item.streamer,
    url: item.url,
    thumbnail: item.thumbnail,
    published: item.published,
    publishedIso: item.published ? new Date(item.published * 1000).toISOString() : '',
    platform: item.platform,
    duration: item.duration,
    filesizeMb: item.filesizeMb,
    resolution: item.resolution,
    category: item.category,
    maxViewers: item.maxViewers,
    avgViewers: item.avgViewers,
    deletionTime: item.deletionTime,
    playerUrl: item.playerUrl,
    recordedAt: item.recordedAt,
    targetId: item.targetId,
  }));
  const seen = new Set<string>();
  const unique = items.filter((entry) => {
    if (seen.has(entry.recordingId)) return false;
    seen.add(entry.recordingId);
    return true;
  });
  ctx.items = unique;
  if (step['saveAs']) ctx.vars[String(step['saveAs'])] = unique;
  ctx.last = unique;
  return { targets: result.targets.length, items: unique.length, total: result.total };
}

function resolvePathInput(value: unknown, ctx: StepContext, fallback: unknown): unknown {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string') {
    if (value.includes('{{')) return resolveValue(value, ctx);
    return resolveExpression(value, ctx);
  }
  return resolveValue(value, ctx);
}

async function runFilterStep(step: WorkflowStep, ctx: StepContext): Promise<unknown> {
  const input = resolvePathInput(step['path'], ctx, ctx.items);
  if (!Array.isArray(input)) throw new Error('filter: Eingabe ist kein Array.');
  const conditions = (step['where'] ?? step['conditions'] ?? []) as Array<Record<string, unknown>>;
  if (!Array.isArray(conditions) || conditions.length === 0) {
    throw new Error('filter: mindestens eine Bedingung erforderlich.');
  }
  const output = input.filter((entry) =>
    conditions.every((condition) => {
      const field = String(condition['field'] ?? '');
      const op = String(condition['op'] ?? 'eq');
      const expected = resolveValue(condition['value'] ?? '', ctx);
      return compare(getPath(entry, field), op, expected);
    }),
  );
  ctx.items = output;
  if (step['saveAs']) ctx.vars[String(step['saveAs'])] = output;
  ctx.last = output;
  return { matched: output.length, total: input.length };
}

async function runSteps(
  steps: WorkflowStep[],
  ctx: StepContext,
  namePrefix = '',
): Promise<void> {
  for (const [index, step] of steps.entries()) {
    const startedAt = Date.now();
    const stepName = `${namePrefix}${step.name ?? step.type}`;
    try {
      let output: unknown;

      switch (String(step.type).toLowerCase()) {
        case 'log': {
          const message = stringify(resolveValue(step['message'] ?? '', ctx));
          logger.info(`[Vorgang ${ctx.workflow.name}] ${message}`);
          output = message;
          break;
        }
        case 'set': {
          const assignments = resolveValue(step['vars'] ?? {}, ctx) as Record<string, unknown>;
          Object.assign(ctx.vars, assignments);
          output = { vars: Object.keys(assignments) };
          break;
        }
        case 'http.request':
        case 'http':
          output = await runHttpStep(step, ctx);
          break;
        case 'streamrecorder.recordings':
          output = await runStreamrecorderStep(step, ctx);
          break;
        case 'filter':
          output = await runFilterStep(step, ctx);
          break;
        case 'foreach': {
          const list = resolvePathInput(step['path'], ctx, ctx.items);
          if (!Array.isArray(list)) throw new Error('foreach: Eingabe ist kein Array.');
          const nested = Array.isArray(step['steps']) ? (step['steps'] as WorkflowStep[]) : [];
          for (const [itemIndex, item] of list.entries()) {
            ctx.item = item;
            ctx.vars['index'] = itemIndex;
            await runSteps(nested, ctx, `${namePrefix}[${itemIndex + 1}] `);
          }
          ctx.last = list;
          output = { iterations: list.length };
          break;
        }
        case 'enqueue_upload': {
          const map = resolveValue(step['map'] ?? {}, ctx) as Record<string, unknown>;
          if (!map['download_url']) throw new Error('enqueue_upload: download_url fehlt.');
          const sourceId = String(map['sourceId'] ?? '').trim();
          if (sourceId) {
            const source = sourceStore.getInternal(sourceId);
            if (source) {
              if (!map['cookie']) map['cookie'] = source.cookie ?? '';
              if (!map['api_base_url']) map['api_base_url'] = source.apiBaseUrl ?? '';
              if (!map['source']) map['source'] = 'streamrecorder';
            }
          }
          const wait = step['wait'] !== false;
          const { record, done } = enqueueJob(map, undefined, wait);
          if (wait && done) {
            const outcome = await done;
            if (outcome.status !== 'success') {
              throw new Error(outcome.error ?? `Job ${outcome.status}`);
            }
          }
          if (sourceId) sourceStore.incrementArchived(sourceId);
          ctx.last = { job_id: record.job_id, key: record.key };
          output = ctx.last;
          break;
        }
        case 'telegram.send': {
          const text = stringify(resolveValue(step['text'] ?? '', ctx));
          const chatId =
            stringify(resolveValue(step['chatId'] ?? '', ctx)) || settingsStore.get().telegram.chatId;
          if (!text) throw new Error('telegram.send: text fehlt.');
          if (!chatId) throw new Error('telegram.send: keine Chat-ID konfiguriert.');
          if (!state.gateway.sendMessage) throw new Error('telegram.send: Gateway nicht verbunden.');
          await state.gateway.sendMessage(chatId, text);
          output = { chatId };
          break;
        }
        case 'delay': {
          const seconds = Number(resolveValue(step['seconds'] ?? 1, ctx)) || 1;
          await sleep(seconds);
          output = { seconds };
          break;
        }
        case 'noop':
          output = null;
          break;
        default:
          throw new Error(`Unbekannter Schritt-Typ: ${step.type}`);
      }

      executionStore.addStep(ctx.executionId, {
        type: String(step.type),
        ...(step.name ? { name: step.name } : {}),
        status: 'ok',
        startedAt,
        finishedAt: Date.now(),
        ...(output !== undefined ? { output } : {}),
      });
    } catch (error) {
      const message = (error as Error).message;
      executionStore.addStep(ctx.executionId, {
        type: String(step.type),
        ...(step.name ? { name: step.name } : {}),
        status: 'error',
        startedAt,
        finishedAt: Date.now(),
        error: message,
      });
      if (step.continueOnError) {
        logger.warn(`[Vorgang ${ctx.workflow.name}] Schritt ${stepName} übersprungen: ${message}`);
        continue;
      }
      throw new Error(`${stepName}: ${message}`);
    }
  }
}

/** Führt einen internen (n8n-freien) Workflow aus und protokolliert alle Schritte. */
export async function runInternalWorkflow(
  workflow: Workflow,
  trigger = 'manual',
): Promise<WorkflowResult> {
  const definition: WorkflowDefinition | undefined = workflow.definition;
  if (!definition) return { status: 'failed', error: 'Workflow hat keine Definition.' };

  const execution = executionStore.create({
    workflowId: workflow.id,
    workflowName: workflow.name,
    trigger,
  });
  const ctx: StepContext = {
    vars: {},
    items: [],
    item: null,
    last: null,
    workflow,
    executionId: execution.id,
  };

  try {
    await runSteps(definition.steps, ctx);
    executionStore.finish(execution.id, { status: 'success' });
    logger.info(`[Vorgang ${workflow.name}] erfolgreich (${execution.id}).`);
    return { status: 'ok' };
  } catch (error) {
    const message = (error as Error).message;
    executionStore.finish(execution.id, { status: 'failed', error: message });
    logger.error(`[Vorgang ${workflow.name}] fehlgeschlagen: ${message}`);
    return { status: 'failed', error: message };
  }
}

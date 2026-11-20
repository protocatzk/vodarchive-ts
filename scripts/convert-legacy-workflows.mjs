#!/usr/bin/env node
/**
 * Konvertiert die alten n8n-Exports (Streamrecorder Auto-Downloader)
 * in interne Workflow-Definitionen des eingebauten Motors.
 *
 * Aufruf:
 *   node scripts/convert-legacy-workflows.mjs --source-id <QUELLEN-ID>
 *
 * Optionen:
 *   --dir <pfad>         Quellverzeichnis (Default: legacy/workflows)
 *   --out <pfad>         Zielverzeichnis (Default: legacy/workflows/converted)
 *   --source-id <id>     Streamrecorder-Quellen-ID (Default: <QUELLEN-ID>)
 *   --source-map <a=id,b=id>  Quellen-IDs pro Account (kommagetrennt)
 *   --disabled           Workflows deaktiviert anlegen (empfohlen)
 *   --interval <sek>     Intervall überschreiben
 *   --keep-chat          chat_id aus dem Legacy-Workflow übernehmen
 *   --api <basis-url>    Direkt in die App importieren (z. B. https://upload.positronium.dev)
 *   --cookie <cookie>    Dashboard-Session für --api (z. B. "vod_session=…")
 *   --dry-run            Nichts schreiben, nur anzeigen
 */

import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function findNode(workflow, nameOrType) {
  return (workflow.nodes ?? []).find(
    (node) => node.name === nameOrType || node.type === nameOrType,
  );
}

function isStreamrecorderWorkflow(workflow) {
  const recordings = findNode(workflow, 'Get Recordings');
  const url = String(recordings?.parameters?.url ?? '');
  return url.includes('/api/user/recordingsv2');
}

function scheduleSeconds(workflow) {
  const trigger = findNode(workflow, 'Schedule Trigger');
  const interval = trigger?.parameters?.rule?.interval?.[0];
  if (!interval) return null;
  if (interval.minutesInterval) return Number(interval.minutesInterval) * 60;
  if (interval.hoursInterval) return Number(interval.hoursInterval) * 3600;
  if (interval.secondsInterval) return Number(interval.secondsInterval);
  return null;
}

function accountName(workflow) {
  const match = String(workflow.name ?? '').match(/ - (.+?)(?: \([^)]*\))?$/);
  if (match && match[1]) return match[1].trim();
  return String(workflow.name ?? 'Streamrecorder');
}

function legacyChatId(workflow) {
  const upload = findNode(workflow, 'Upload to Telegram');
  const params = upload?.parameters?.bodyParameters?.parameters ?? [];
  const chat = params.find((entry) => entry.name === 'chat_id');
  return chat ? String(chat.value ?? '').trim() : '';
}

function parseSourceMap(raw) {
  const map = {};
  if (!raw) return map;
  for (const pair of String(raw).split(',')) {
    const [account, id] = pair.split('=').map((value) => value.trim());
    if (account && id) map[account.toLowerCase()] = id;
  }
  return map;
}

function slugify(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'workflow'
  );
}

function buildDefinition({ interval, sourceId, keepChat, chatId }) {
  const map = {
    download_url: '{{ item.url }}',
    source: 'streamrecorder',
    use_ytdlp: false,
    recording_id: '{{ item.recordingId }}',
    streamer: '{{ item.streamer }}',
    title: '{{ item.title }}',
    thumbnail_url: '{{ item.thumbnail }}',
    platform: '{{ item.platform }}',
    recorded_at: '{{ item.recordedAt }}',
    sourceId,
  };
  if (keepChat && chatId) map.chat_id = chatId;

  return {
    trigger: { type: 'schedule', intervalSeconds: interval },
    steps: [
      { type: 'streamrecorder.recordings', sourceId, saveAs: 'items' },
      { type: 'filter', where: [{ field: 'url', op: 'exists' }] },
      {
        type: 'foreach',
        path: 'items',
        steps: [{ type: 'enqueue_upload', wait: true, map }],
      },
    ],
  };
}

async function pushWorkflow(apiBase, cookie, payload) {
  const url = `${apiBase.replace(/\/+$/, '')}/voduploader/api/workflows`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return text;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = path.resolve(args.dir ?? 'legacy/workflows');
  const outDir = path.resolve(args.out ?? path.join(dir, 'converted'));
  const sourceId = String(args['source-id'] ?? '<QUELLEN-ID>');
  const sourceMap = parseSourceMap(args['source-map']);
  const intervalOverride = args.interval ? Number(args.interval) : null;

  if (!fs.existsSync(dir)) {
    console.error(`Quellverzeichnis nicht gefunden: ${dir}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    console.error(`Keine Workflow-JSONs in ${dir}`);
    process.exit(1);
  }

  if (!args['dry-run']) fs.mkdirSync(outDir, { recursive: true });

  let converted = 0;
  let skipped = 0;

  for (const file of files) {
    let workflow;
    try {
      workflow = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (error) {
      console.warn(`! ${file}: kein gültiges JSON (${error.message})`);
      skipped += 1;
      continue;
    }

    if (!isStreamrecorderWorkflow(workflow)) {
      console.warn(`! ${file}: kein Streamrecorder-Muster, übersprungen`);
      skipped += 1;
      continue;
    }

    const account = accountName(workflow);
    const interval = intervalOverride ?? scheduleSeconds(workflow) ?? 900;
    const chatId = legacyChatId(workflow);
    const accountSourceId = sourceMap[account.toLowerCase()] ?? sourceId;
    if (Object.keys(sourceMap).length > 0 && !sourceMap[account.toLowerCase()]) {
      console.warn(`  ! Kein --source-map-Eintrag für ${account}, nutze --source-id`);
    }
    const definition = buildDefinition({
      interval,
      sourceId: accountSourceId,
      keepChat: Boolean(args['keep-chat']),
      chatId,
    });
    const payload = {
      name: `Streamrecorder – ${account}`,
      kind: 'internal',
      ...(args.disabled ? { enabled: false } : {}),
      definition,
    };

    const outFile = path.join(outDir, `${slugify(account)}.json`);
    if (args['dry-run']) {
      console.log(`\n# ${file} -> ${path.basename(outFile)}`);
      console.log(JSON.stringify(payload, null, 2));
    } else {
      fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
      console.log(`✓ ${file} -> ${path.relative(process.cwd(), outFile)}`);
    }

    if (args.api) {
      try {
        await pushWorkflow(String(args.api), args.cookie ? String(args.cookie) : '', payload);
        console.log(`  → in App importiert: ${payload.name}`);
      } catch (error) {
        console.warn(`  ! Import fehlgeschlagen: ${error.message}`);
      }
    }

    converted += 1;
  }

  console.log(`\n${converted} konvertiert, ${skipped} übersprungen.`);
  if (!args['dry-run'] && converted > 0) {
    console.log(`Ziel: ${path.relative(process.cwd(), outDir)}`);
    if (sourceId === '<QUELLEN-ID>' && Object.keys(sourceMap).length === 0) {
      console.log('Hinweis: --source-id <ID> oder --source-map … setzen, damit die Workflows laufen.');
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

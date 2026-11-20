import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config';
import { logger } from '../logger';
import type { VideoMetadata } from '../telegram/gateway';

export interface ProcessOptions {
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
  signal?: AbortSignal;
}

/** Startet einen Prozess und liefert Exit-Code; stdin/stdout werden zeilenweise weitergereicht. */
export function runProcess(
  command: string,
  args: string[],
  options: ProcessOptions = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderrTail = '';

    const wire = (stream: NodeJS.ReadableStream | null, cb?: (line: string) => void): void => {
      if (!stream) return;
      let buffer = '';
      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) if (line.trim() && cb) cb(line.trim());
      });
    };

    wire(child.stdout, options.onStdout);
    wire(child.stderr, (line) => {
      stderrTail = (stderrTail + line + '\n').slice(-4000);
      options.onStderr?.(line);
    });

    const abort = (): void => {
      child.kill('SIGKILL');
      reject(new Error(`Prozess abgebrochen: ${command}`));
    };
    if (options.signal) {
      if (options.signal.aborted) {
        abort();
        return;
      }
      options.signal.addEventListener('abort', abort, { once: true });
    }

    child.on('error', (error) => {
      reject(new Error(`${command} konnte nicht gestartet werden: ${error.message}`));
    });
    child.on('close', (code) => {
      if (options.signal) options.signal.removeEventListener('abort', abort);
      if (code === 0) resolve(0);
      else reject(new Error(`${command} beendete mit Code ${code}: ${stderrTail.trim()}`));
    });
  });
}

function parseFfmpegTime(line: string): number | null {
  const match = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);
  if (!match) return null;
  const [, h, m, s] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

export interface DownloadOptions {
  onProgress?: (doneBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
}

/** Laedt eine URL per HTTP-Stream auf die Festplatte. */
export async function downloadHttp(
  url: string,
  dest: string,
  options: DownloadOptions = {},
): Promise<number> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const response = await fetch(url, { signal: options.signal, redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Download fehlgeschlagen (HTTP ${response.status}) für ${url}`);
  }
  const total = Number(response.headers.get('content-length') ?? 0);
  let done = 0;

  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      done += chunk.length;
      options.onProgress?.(done, total);
      callback(null, chunk);
    },
  });

  const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(body, counter, fs.createWriteStream(dest));
  return done;
}

/** Laedt ein VOD per yt-dlp herunter. */
export async function downloadWithYtDlp(
  url: string,
  dest: string,
  options: DownloadOptions = {},
): Promise<number> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const args = [
    '--no-playlist',
    '--newline',
    '--no-part',
    '-o',
    dest,
    ...(config.ytdlp.format ? ['-f', config.ytdlp.format] : ['-f', 'bv*+ba/b']),
    ...(config.ytdlp.cookiesFile ? ['--cookies', config.ytdlp.cookiesFile] : []),
    ...(config.ytdlp.proxy ? ['--proxy', config.ytdlp.proxy] : []),
    '--concurrent-fragments',
    String(config.ytdlp.concurrentFragments),
    '--retries',
    String(config.ytdlp.retries),
    url,
  ];

  let total = 0;
  await runProcess(config.media.ytdlpPath, args, {
    signal: options.signal,
    onStdout: (line) => {
      const sizeMatch = /of\s+~?\s*([\d.]+)(KiB|MiB|GiB)/i.exec(line);
      if (sizeMatch && !total) {
        const value = Number(sizeMatch[1]);
        const unit = (sizeMatch[2] ?? 'MiB').toLowerCase();
        const factor = unit === 'kib' ? 1024 : unit === 'gib' ? 1024 ** 3 : 1024 ** 2;
        total = Math.round(value * factor);
      }
      const pctMatch = /\[download\]\s+([\d.]+)%/.exec(line);
      if (pctMatch) {
        const pct = Number(pctMatch[1]);
        options.onProgress?.(Math.round((total * pct) / 100), total);
      }
    },
  });

  return fs.statSync(dest).size;
}

/** Ermittelt Dauer und Abmessungen per ffprobe. */
export async function probeVideo(file: string): Promise<VideoMetadata | null> {
  let output = '';
  try {
    await runProcess(
      config.media.ffprobePath,
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        file,
      ],
      { onStdout: (line) => (output += line) },
    );
    const parsed = JSON.parse(output) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    };
    const video = parsed.streams?.find((stream) => stream.codec_type === 'video');
    return {
      duration: Number(parsed.format?.duration ?? 0) || 0,
      width: video?.width ?? 0,
      height: video?.height ?? 0,
    };
  } catch (error) {
    logger.warn(`ffprobe fehlgeschlagen für ${path.basename(file)}: ${String(error)}`);
    return null;
  }
}

export interface SplitResult {
  parts: string[];
  totalBytes: number;
}

/**
 * Teilt eine Datei per ffmpeg in Teile nahe der Zielgroesse.
 * Nutzt Stream-Copy, um ohne Re-Encoding schnell zu bleiben.
 */
export async function splitFile(
  file: string,
  targetBytes: number,
  options: { onProgress?: (pct: number) => void; signal?: AbortSignal } = {},
): Promise<SplitResult> {
  const size = fs.statSync(file).size;
  if (size <= targetBytes) return { parts: [file], totalBytes: size };

  const meta = await probeVideo(file);
  const duration = meta?.duration ?? 0;
  if (!duration) {
    logger.warn('Dauer unbekannt – Datei wird nicht aufgeteilt.');
    return { parts: [file], totalBytes: size };
  }

  const segmentSeconds = Math.max(10, Math.floor(duration * (targetBytes / size)));
  const ext = path.extname(file) || '.mp4';
  const base = path.join(path.dirname(file), `part_%03d${ext}`);

  logger.info(
    `Teile ${path.basename(file)} (${gb(size)}) in ~${gb(targetBytes)}-Teile (Segment ${segmentSeconds}s)...`,
  );

  await runProcess(
    config.media.ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'info',
      '-i',
      file,
      '-c',
      'copy',
      '-map',
      '0',
      '-f',
      'segment',
      '-segment_time',
      String(segmentSeconds),
      '-reset_timestamps',
      '1',
      base,
    ],
    {
      signal: options.signal,
      onStderr: (line) => {
        const time = parseFfmpegTime(line);
        if (time !== null && duration > 0) {
          options.onProgress?.(Math.min(99, Math.round((time / duration) * 100)));
        }
      },
    },
  );

  const dir = path.dirname(file);
  const prefix = 'part_';
  const parts = fs
    .readdirSync(dir)
    .filter((entry) => entry.startsWith(prefix) && entry.endsWith(ext))
    .sort()
    .map((entry) => path.join(dir, entry));

  if (parts.length === 0) return { parts: [file], totalBytes: size };
  return { parts, totalBytes: size };
}

export function gb(bytes: number): string {
  return `${(bytes / (1024 ** 3)).toFixed(2)} GB`;
}

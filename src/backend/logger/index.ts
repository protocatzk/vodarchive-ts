export type LogLevel = 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG';

export interface LogLine {
  time: string;
  level: LogLevel;
  message: string;
}

const MAX_BUFFER = 400;
const buffer: LogLine[] = [];
type Listener = (line: LogLine) => void;
const listeners = new Set<Listener>();

function timestamp(): string {
  return new Date().toLocaleTimeString('de-DE', { hour12: false });
}

function format(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function emit(level: LogLevel, message: string): void {
  const line: LogLine = { time: timestamp(), level, message };
  buffer.push(line);
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
  for (const listener of listeners) {
    try {
      listener(line);
    } catch {
      /* ignore listener failures */
    }
  }
  const prefix = `[${line.time}] ${level}`;
  if (level === 'ERROR') console.error(prefix, message);
  else if (level === 'WARNING') console.warn(prefix, message);
  else console.log(prefix, message);
}

export const logger = {
  info(message: string, ...args: unknown[]): void {
    emit('INFO', args.length ? `${message} ${args.map(format).join(' ')}` : message);
  },
  warn(message: string, ...args: unknown[]): void {
    emit('WARNING', args.length ? `${message} ${args.map(format).join(' ')}` : message);
  },
  error(message: string, ...args: unknown[]): void {
    emit('ERROR', args.length ? `${message} ${args.map(format).join(' ')}` : message);
  },
  debug(message: string, ...args: unknown[]): void {
    if (process.env.DEBUG) emit('DEBUG', args.length ? `${message} ${args.map(format).join(' ')}` : message);
  },
  buffer(): LogLine[] {
    return [...buffer];
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

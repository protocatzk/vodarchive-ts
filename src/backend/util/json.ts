import fs from 'node:fs';
import path from 'node:path';

/** Liest eine JSON-Datei oder liefert den Fallback. */
export function readJsonFile<T>(file: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Schreibt JSON atomar (tmp + rename), optional mit Dateimodus. */
export function writeJsonFileAtomic(file: string, data: unknown, mode?: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', ...(mode ? { mode } : {}) });
  fs.renameSync(tmp, file);
}

/** Rekursiver Merge von Objekten (Arrays werden ersetzt). */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (Array.isArray(base) || Array.isArray(patch)) return (patch as T) ?? base;
  if (
    base &&
    typeof base === 'object' &&
    patch &&
    typeof patch === 'object' &&
    !Array.isArray(patch)
  ) {
    const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
      if (value === undefined) continue;
      const current = result[key];
      result[key] =
        current && typeof current === 'object' && value && typeof value === 'object'
          ? deepMerge(current, value)
          : value;
    }
    return result as T;
  }
  return (patch as T) ?? base;
}

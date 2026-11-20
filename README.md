# VODArchive (TypeScript + Vue Rewrite)

Neuauflage des `streamrecorder-n8n-vod-uploader` als **TypeScript-Backend (Express)** mit
**Vue-3-Frontend (Vite + Tailwind)**. Die urspüngliche Python-Implementierung liegt als
Referenz unter [`legacy/`](./legacy).

## Status des Rewrites

| Bereich | Status |
| --- | --- |
| Express-API, Health, Auth-Flow | ✅ portiert |
| Persistenter Job-Store (`jobs.json`, `done.json`) | ✅ portiert |
| Topic-Cache + Smart-Matching + CRUD-API | ✅ portiert |
| Vue-Dashboard (SSE-Live-Status, Jobs, Logs) | ✅ implementiert |
| Vue-Topic-Verwaltung (Aliase, Remap, Löschen) | ✅ implementiert |
| RSS-Feed-Verarbeitung (RSS/Atom + OPML, State, Retry) | ✅ implementiert |
| n8n-Webhook-Trigger | ✅ portiert |
| Upload-Pipeline (HTTP/yt-dlp → ffmpeg-Split → Upload) | ✅ implementiert |
| Telegram MTProto (GramJS) | ✅ implementiert |
| Paralleler (Fast-)Upload | ✅ via GramJS `workers` |

> Hinweis: Die Telegram- und Medien-Pipeline ist implementiert, benötigt aber
> gültige Zugangsdaten sowie `ffmpeg`/`ffprobe` (und optional `yt-dlp`). Ein
> Live-Test gegen Telegram ist in dieser Umgebung nicht möglich. Mit
> `SIMULATE_JOBS=true` lässt sich die UI ohne externe Dienste testen.

Das Backend ist so aufgebaut, dass die fehlenden Teile hinter klaren Schnittstellen
(`src/backend/telegram/gateway.ts`, `src/backend/rss/archiver.ts`, Upload-Worker)
ergänzt werden können, ohne API oder UI zu ändern.

## Voraussetzungen

- Node.js ≥ 20
- pnpm ≥ 10 (`npm install -g pnpm`)

## Lokale Entwicklung

```bash
pnpm install
cp .env.example .env      # Werte anpassen (AUTH_DEV_MODE=true für lokalen Login)
pnpm dev                  # Backend (8080) + Vite-Devserver (5173)
```

Aufruf: <http://localhost:5173>. Der Vite-Devserver proxied alle API-Pfade an das
Backend. Mit `AUTH_DEV_MODE=true` wird der Telegram-Login übersprungen.

## Build & Produktion

```bash
pnpm build                # baut Frontend (dist/public) + Backend (dist/backend)
pnpm start                # startet den Express-Server auf PORT (Default 8080)
```

Der Server liefert dann Frontend und API unter derselben Adresse aus.

## Docker

```bash
cp .env.example .env
docker compose up -d --build
```

- Port: `8080`
- Persistente Daten: `./data` (Job-Store, Topic-Cache, RSS-State)
- Multi-Stage-Build mit pnpm, Runtime auf `node:20-alpine`

## Umgebungsvariablen (Auszug)

Die vollständige Liste steht in [`.env.example`](./.env.example).

| Variable | Bedeutung |
| --- | --- |
| `PORT` | HTTP-Port des Backends (Default `8080`) |
| `DATA_DIR` | Datenverzeichnis (Default `data`) |
| `AUTH_DEV_MODE` | `true` = Login ohne Telegram (nur Entwicklung!) |
| `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_BOT_TOKEN` | MTProto-Zugang |
| `TELEGRAM_SESSION_FILE` | Persistente GramJS-StringSession |
| `TELEGRAM_FORUM_CHAT_ID` | Ziel-Forum für Topics |
| `TOPICS_CACHE_FILE` | Pfad zum Topic-Cache (Default `<DATA_DIR>/topics_cache.json`) |
| `RSS_ENABLED`, `RSS_FEED_URLS`, `RSS_OPML_FILE` | RSS-Archiv |
| `N8N_WEBHOOKS_JSON` | JSON-Map `{"name":"https://…/webhook/…"}` |
| `SIMULATE_JOBS` | `true` = Upload-Pipeline simulieren |
| `PARALLEL_UPLOAD_WORKERS` | Parallele Upload-Worker (GramJS) |
| `YTDLP_PATH`, `FFMPEG_PATH`, `FFPROBE_PATH` | Pfade zu den Binaries |
| `KEEP_JOB_FILES` | Temporäre Dateien nach Upload behalten |

## API-Endpunkte

Kompatibel zum Original unter `/voduploader/...`, zusätzlich als `/api/...`-Alias.

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| `POST` | `/upload` | Job von n8n annehmen |
| `GET` | `/health` | Health/Status |
| `GET` | `/voduploader/api/status` | Dashboard-Snapshot |
| `GET` | `/voduploader/api/events` | SSE-Live-Stream |
| `POST` | `/voduploader/api/jobs/cancel` | Job abbrechen |
| `GET/POST/PATCH/DELETE` | `/voduploader/api/topics` | Topic-Verwaltung |
| `POST/DELETE` | `/voduploader/api/topics/alias` | Aliase |
| `GET` | `/rss/status` | RSS-Status |
| `POST` | `/rss/check` · `/rss/backfill` · `/voduploader/api/rss/retry` | RSS-Steuerung |
| `POST` | `/voduploader/n8n/run?name=…` | n8n-Workflow starten |
| `POST` | `/voduploader/api/auth/request` · `GET …/auth/check` · `POST …/logout` | Login |

## Projektstruktur

```
src/
├── backend/
│   ├── api/routes/      # auth, status, system, topics, rss, n8n, upload
│   ├── config/          # zentrale Env-Konfiguration
│   ├── jobs/            # Job-Store, Worker, echte Pipeline (media.ts)
│   ├── logger/          # Logger mit In-Memory-Ringpuffer für die UI
│   ├── rss/             # RSS/Atom+OPML-Parsing, State, Polling
│   ├── telegram/        # Gateway-Interface, GramJS-Implementierung, Platzhalter
│   ├── topic/           # Topic-Manager (Cache, Matching, Telegram)
│   ├── state.ts         # Laufzeit-Zustand (Queue, History, Sessions, Waiters)
│   ├── server.ts        # Express-App
│   └── main.ts          # Entrypoint (Telegram + RSS init)
└── frontend/
    ├── components/      # Header, Cards, Tabellen, Log-Konsole, Toasts
    ├── composables/     # useToast
    ├── lib/api.ts       # Axios-Client + Endpunkte
    ├── stores/          # Pinia: auth, dashboard, topics
    ├── views/           # Login, Dashboard, Topics
    ├── router.ts
    └── main.ts
```

## Implementierungsdetails

- **Telegram (GramJS):** `src/backend/telegram/gramjs.ts` – Bot-Login via
  `botAuthToken`, persistente `StringSession`, Forum-Topics
  (`channels.CreateForumTopic`), Forwarding (`messages.ForwardMessages`) und
  Video-Upload (`sendFile` mit `topMsgId` + `workers` für parallelen Upload).
- **Upload-Pipeline:** `src/backend/jobs/pipeline.ts` + `media.ts` – Download per
  HTTP-Stream oder `yt-dlp`, `ffprobe`-Metadaten, `ffmpeg`-Segmentierung per
  Stream-Copy nahe der Zielgröße, anschließender Upload in das passende Topic.
- **RSS:** `src/backend/rss/archiver.ts` – liest `RSS_FEED_URLS` und optional
  OPML, parst RSS/Atom, dedupliziert über einen State, filtert nach Alter und
  reiht neue Items mit Wartezeit (`wait=true`) in die Pipeline ein; Retry mit
  Backoff.

## Bekannte Einschränkungen

- **Login-Freigabe:** Der Browser-Login erzeugt Token + Deep-Link; die
  Bestätigung per Telegram-Inline-Buttons (`/start login_<token>` + Callback)
  ist noch nicht an das GramJS-Gateway angebunden. Bis dahin `AUTH_DEV_MODE=true`
  nutzen oder die Session serverseitig setzen.
- **Live-Streams:** RSS-Live-Erkennung/Re-Check ist noch nicht umgesetzt.
- **ffmpeg-Split:** nutzt Stream-Copy; Schnittpunkte hängen von Keyframes ab.
- **RSS-Status „archived"** bedeutet „erfolgreich in die Pipeline eingereiht und
  Job abgeschlossen" (der Handler wartet auf das Job-Ergebnis).

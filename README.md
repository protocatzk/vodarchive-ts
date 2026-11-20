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

- Der Container lauscht intern auf `8080`, wird aber nur auf
  `127.0.0.1:8081` veröffentlicht (für einen Reverse-Proxy davor).
- Persistente Daten: `./data` (Job-Store, Topic-Cache, RSS-State, Telegram-Session)
- Multi-Stage-Build mit pnpm, Runtime auf `node:20-alpine` inkl. `ffmpeg`/`yt-dlp`

### Öffentlich erreichbar via Caddy

`deploy/Caddyfile.example` enthält den passenden Site-Block:

```caddyfile
upload.positronium.dev {
    encode zstd gzip
    log
    reverse_proxy 127.0.0.1:8081 {
        flush_interval -1
    }
}
```

- In `/etc/caddy/Caddyfile` einfügen, `caddy validate` und Caddy neu starten.
- Caddy holt automatisch ein Let's-Encrypt-Zertifikat (DNS muss auf den Server zeigen).
- `flush_interval -1` hält den SSE-Live-Stream offen.
- Bei `NODE_ENV=production` wird das Session-Cookie nur über HTTPS gesetzt – passt
  zum Caddy-Setup. Für lokale HTTP-Tests `NODE_ENV=development` verwenden.

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
- **Dashboard-Login:** `GET /voduploader/api/auth/request` erzeugt ein Token und
  einen Deep-Link `https://t.me/<bot>?start=login_<token>`. Der Bot-Handler
  (`startAuthFlow` im GramJS-Gateway) prüft den Absender gegen
  `ALLOWED_DASHBOARD_USERS` und sendet Inline-Buttons
  („✅ Anmelden freigeben“ / „❌ Ablehnen“). Der Callback setzt den Token-Status;
  der Browser pollt `.../auth/check` und erhält bei Freigabe ein
  `vod_session`-Cookie. Ohne verbundenen Bot antwortet der Endpoint mit `503`.

## Bekannte Einschränkungen

- **Live-Streams:** RSS-Live-Erkennung/Re-Check ist noch nicht umgesetzt.
- **ffmpeg-Split:** nutzt Stream-Copy; Schnittpunkte hängen von Keyframes ab.
- **RSS-Status „archived"** bedeutet „erfolgreich in die Pipeline eingereiht und
  Job abgeschlossen" (der Handler wartet auf das Job-Ergebnis).
- **Login:** benötigt einen verbundenen Bot und mindestens einen Eintrag in
  `ALLOWED_DASHBOARD_USERS`; für lokale Entwicklung `AUTH_DEV_MODE=true` nutzen.

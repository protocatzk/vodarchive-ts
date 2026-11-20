import express, { type NextFunction, type Request, type Response } from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { logger } from './logger';
import { authRouter } from './api/routes/auth';
import { n8nRouter } from './api/routes/n8n';
import { rssRouter } from './api/routes/rss';
import { statusRouter } from './api/routes/status';
import { systemRouter, healthHandler } from './api/routes/system';
import { topicsRouter } from './api/routes/topics';
import { uploadRouter } from './api/routes/upload';
import { settingsRouter } from './api/routes/settings';
import { sourcesRouter } from './api/routes/sources';
import { workflowsRouter } from './api/routes/workflows';

export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));

  // Health (root + voduploader-Prefix fuer Kompatibilitaet)
  app.get('/health', healthHandler);
  app.get('/voduploader/health', healthHandler);

  // n8n-/RSS-/Upload-Endpunkte (root + voduploader-Prefix)
  app.use('/upload', uploadRouter);
  app.use('/voduploader/upload', uploadRouter);
  app.use('/rss', rssRouter);
  app.use('/voduploader/rss', rssRouter);
  app.use('/n8n', n8nRouter);
  app.use('/voduploader/n8n', n8nRouter);

  // Dashboard-API unter /voduploader/api und /api
  const api = express.Router();
  api.use('/auth', authRouter);
  api.use('/', statusRouter);
  api.use('/', systemRouter);
  api.use('/topics', topicsRouter);
  api.use('/settings', settingsRouter);
  api.use('/sources', sourcesRouter);
  api.use('/workflows', workflowsRouter);

  app.use('/voduploader/api', api);
  app.use('/api', api);

  // Kompatibilitaets-Redirects der alten Seiten
  app.get(['/voduploader', '/voduploader/'], (_req, res) => res.redirect('/'));
  app.get(['/voduploader/topics', '/voduploader/topics/'], (_req, res) => res.redirect('/topics'));

  // Statisches Frontend (Production-Build)
  const publicDir = path.resolve(process.cwd(), 'dist/public');
  const indexFile = path.join(publicDir, 'index.html');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir, { index: false }));
    app.get('*', (req, res, next) => {
      if (req.method !== 'GET') return next();
      if (
        req.path.startsWith('/api') ||
        req.path.startsWith('/voduploader/api') ||
        req.path.startsWith('/rss') ||
        req.path.startsWith('/n8n') ||
        req.path.startsWith('/upload') ||
        req.path.startsWith('/health')
      ) {
        return next();
      }
      res.sendFile(indexFile);
    });
  } else {
    app.get('/', (_req, res) => {
      res
        .status(200)
        .type('text')
        .send(
          'VODArchive API läuft. Frontend nicht gebaut – nutze im Dev-Modus http://localhost:5173 ' +
            'oder baue mit "pnpm build".',
        );
    });
  }

  // 404 für unbekannte API-Routen
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/voduploader/api')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    next();
  });

  // Zentraler Error-Handler
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error(`Unhandled request error: ${String(err)}`);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

export function startServer(): void {
  const app = createApp();
  app.listen(config.port, () => {
    logger.info(
      `VODArchive Server gestartet auf http://0.0.0.0:${config.port} ` +
        `(env=${config.isProduction ? 'production' : 'development'}, devAuth=${config.auth.devMode}).`,
    );
  });
}

import { Router } from 'express';
import crypto from 'node:crypto';
import { config } from '../../config';
import { logger } from '../../logger';
import { state, type PendingAuth } from '../../state';
import {
  clearSessionCookie,
  createSession,
  getAuthedSession,
  SESSION_COOKIE,
  setSessionCookie,
} from '../middleware/auth';

export const authRouter = Router();

function cleanupPending(): void {
  const now = Date.now() / 1000;
  for (const [token, info] of state.pendingAuth) {
    if (now - info.created_at > config.auth.pendingTokenTtlSeconds) state.pendingAuth.delete(token);
  }
}

authRouter.post('/request', (req, res) => {
  // Dev-Modus: sofort einloggen, ohne Telegram.
  if (config.auth.devMode) {
    const { sessionId, session } = createSession(config.auth.devUser);
    setSessionCookie(res, sessionId);
    res.json({
      token: 'dev',
      bot_username: '',
      deep_link: '',
      status: 'approved',
      user: session.user,
      dev: true,
    });
    return;
  }

  cleanupPending();
  const token = crypto.randomBytes(12).toString('hex');
  const pending: PendingAuth = { status: 'pending', created_at: Date.now() / 1000, user: '' };
  state.pendingAuth.set(token, pending);

  const bot = state.botUsername;
  const deepLink = bot
    ? `https://t.me/${bot}?start=login_${token}`
    : `https://t.me/?start=login_${token}`;

  res.json({ token, bot_username: bot, deep_link: deepLink, status: 'pending' });
});

authRouter.get('/check', (req, res) => {
  if (config.auth.devMode) {
    let session = getAuthedSession(req);
    if (!session) {
      const created = createSession(config.auth.devUser);
      setSessionCookie(res, created.sessionId);
      session = created.session;
    }
    res.json({ status: 'approved', user: session.user, dev: true });
    return;
  }

  const token = String(req.query['token'] ?? '');
  const info = state.pendingAuth.get(token);
  if (!token || !info) {
    res.json({ status: 'expired' });
    return;
  }

  if (info.status === 'approved') {
    const { sessionId, session } = createSession(info.user || 'Admin');
    state.pendingAuth.delete(token);
    setSessionCookie(res, sessionId);
    res.json({ status: 'approved', user: session.user });
    return;
  }

  res.json({ status: info.status });
});

authRouter.post('/logout', (req, res) => {
  const sessionId = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (sessionId) state.sessions.delete(sessionId);
  clearSessionCookie(res);
  res.json({ status: 'ok' });
});

authRouter.get('/session', (req, res) => {
  const session = getAuthedSession(req);
  if (!session) {
    if (config.auth.devMode) {
      res.json({ authenticated: true, user: config.auth.devUser, dev: true });
      return;
    }
    res.status(401).json({ authenticated: false });
    return;
  }
  res.json({ authenticated: true, user: session.user });
});

logger.debug('Auth-Router registriert.');

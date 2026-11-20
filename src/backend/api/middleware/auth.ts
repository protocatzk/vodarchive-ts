import type { NextFunction, Request, Response } from 'express';
import crypto from 'node:crypto';
import { config } from '../../config';
import { state, type Session } from '../../state';

export const SESSION_COOKIE = 'vod_session';

export function getAuthedSession(req: Request): Session | null {
  const sessionId = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!sessionId) return null;
  const session = state.sessions.get(sessionId);
  if (!session) return null;
  if (Date.now() / 1000 > session.expires_at) {
    state.sessions.delete(sessionId);
    return null;
  }
  return session;
}

export function createSession(user: string): { sessionId: string; session: Session } {
  const sessionId = crypto.randomBytes(32).toString('base64url');
  const session: Session = {
    user,
    expires_at: Date.now() / 1000 + config.auth.sessionTtlSeconds,
  };
  state.sessions.set(sessionId, session);
  return { sessionId, session };
}

export function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie(SESSION_COOKIE, sessionId, {
    maxAge: config.auth.sessionTtlSeconds * 1000,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Express-Middleware, die eine gueltige Dashboard-Session erzwingt. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (config.auth.devMode) {
    if (!getAuthedSession(req)) {
      const { sessionId } = createSession(config.auth.devUser);
      setSessionCookie(res, sessionId);
    }
    next();
    return;
  }
  if (!getAuthedSession(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

/** Liefert den Nutzernamen der Session oder den Dev-Nutzer. */
export function sessionUser(req: Request): string {
  return getAuthedSession(req)?.user || config.auth.devUser;
}

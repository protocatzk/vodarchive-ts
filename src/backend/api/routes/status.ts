import { Router } from 'express';
import { requireAuth, sessionUser } from '../middleware/auth';
import { buildSnapshot } from '../snapshot';

export const statusRouter = Router();

statusRouter.get('/status', requireAuth, (req, res) => {
  res.json(buildSnapshot(sessionUser(req)));
});

statusRouter.get('/events', requireAuth, (req, res) => {
  req.socket.setTimeout(0);
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const send = (): void => {
    const payload = buildSnapshot(sessionUser(req));
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send();
  const interval = setInterval(send, 1500);

  req.on('close', () => {
    clearInterval(interval);
    res.end();
  });
});

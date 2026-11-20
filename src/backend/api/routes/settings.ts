import { Router } from 'express';
import { settingsStore } from '../../settings/store';
import { requireAuth } from '../middleware/auth';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

settingsRouter.get('/', (_req, res) => {
  res.json(settingsStore.getMasked());
});

settingsRouter.put('/', (req, res) => {
  try {
    const result = settingsStore.update(req.body);
    res.json({
      status: 'ok',
      restartRequired: result.restartRequired,
      settings: settingsStore.getMasked(),
    });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

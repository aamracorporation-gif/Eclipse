const express = require('express');
const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const { authMiddleware, requireRole } = require('../middlewares/auth');
const { asyncHandler } = require('../utils/asyncHandler');
const { cancellationServices } = require('../services/cancellation/runtime');
const router = express.Router();
router.use(authMiddleware, requireRole(['organizer', 'ORGANIZER']));
router.use(rateLimit({ windowMs: 60000, max: 20, standardHeaders: true, legacyHeaders: false }));
router.get('/', asyncHandler(async (req, res) => res.json(await cancellationServices().billing.overview(req.auth.userId))));
router.post('/setup', asyncHandler(async (req, res) => {
  const input = z.object({ accepted: z.literal(true), version: z.string().max(100), sha256: z.string().length(64) }).strict().parse(req.body);
  res.json(await cancellationServices().billing.beginSetup(req.auth.userId, input));
}));
router.post('/setup/:id/confirm', asyncHandler(async (req, res) => {
  res.json(await cancellationServices().billing.confirmSetup(req.auth.userId, z.string().uuid().parse(req.params.id)));
}));
router.post('/events/:id/cancel', asyncHandler(async (req, res) => {
  if (process.env.ORGANIZER_CANCELLATION_WORKER_ENABLED !== 'true') {
    return res.status(503).json({ error: 'El servicio de devoluciones todavía no está disponible.' });
  }
  const { reason } = z.object({ reason: z.string().trim().min(3).max(500) }).strict().parse(req.body);
  const result = await cancellationServices().billing.requestCancellation(req.auth.userId, z.string().uuid().parse(req.params.id), reason);
  res.status(202).json({ cancellationId: result.id, status: result.status });
}));
router.post('/collections/:id/pay', asyncHandler(async (req, res) => {
  res.json(await cancellationServices().collections.acknowledgeAndCollect(z.string().uuid().parse(req.params.id), req.auth.userId));
}));
module.exports = { organizerBillingRoutes: router };

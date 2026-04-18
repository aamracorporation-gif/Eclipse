const { z } = require('zod');
const { asyncHandler } = require('../utils/asyncHandler');
const { createEvent, listEvents, updateEvent, deleteEvent } = require('../services/eventService');

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional().default(''),
  event_date: z.string().min(1).max(60),
  ticket_price: z.number().nonnegative(),
  available_tickets: z.number().int().nonnegative(),
  venue_id: z.string().uuid().optional(),
  poster_url: z.string().max(500).optional(),
});

const updateSchema = createSchema.partial().refine((v) => Object.keys(v).length > 0, { message: 'No updates provided' });

const create = asyncHandler(async (req, res) => {
  const input = createSchema.parse(req.body);
  const event = await createEvent({ creatorId: req.auth.userId, payload: input });
  return res.status(201).json({ ok: true, event });
});

const list = asyncHandler(async (req, res) => {
  const events = await listEvents();
  return res.json({ ok: true, events });
});

const update = asyncHandler(async (req, res) => {
  const input = updateSchema.parse(req.body);
  const eventId = String(req.params.id || '');
  const event = await updateEvent({ eventId, creatorId: req.auth.userId, updates: input });
  return res.json({ ok: true, event });
});

const remove = asyncHandler(async (req, res) => {
  const eventId = String(req.params.id || '');
  await deleteEvent({ eventId, creatorId: req.auth.userId });
  return res.json({ ok: true });
});

module.exports = { create, list, update, remove };

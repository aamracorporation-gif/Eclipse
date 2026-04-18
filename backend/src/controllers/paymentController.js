const { z } = require('zod');
const { asyncHandler } = require('../utils/asyncHandler');
const { createIntentForEvent } = require('../services/paymentService');

const createIntentSchema = z.object({
  event_id: z.string().uuid(),
  quantity: z.number().int().positive().optional(),
  ticket_type_id: z.string().uuid().optional().nullable(),
});

const createIntent = asyncHandler(async (req, res) => {
  const input = createIntentSchema.parse(req.body);
  const out = await createIntentForEvent({
    eventId: input.event_id,
    userId: req.auth.userId,
    quantity: input.quantity,
    ticketTypeId: input.ticket_type_id || null,
  });
  return res.json({ ok: true, client_secret: out.clientSecret, payment_intent_id: out.paymentIntentId });
});

module.exports = { createIntent };

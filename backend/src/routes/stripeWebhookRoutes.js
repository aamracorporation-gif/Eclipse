const express = require('express');
const { handleStripeWebhook } = require('../services/paymentService');

const router = express.Router();

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const signature = String(req.headers['stripe-signature'] || '');
  const out = await handleStripeWebhook(req.body, signature);
  if (out?.text) return res.status(out.status || 500).send(out.text);
  return res.status(out.status || 500).json(out.json || { received: true });
});

module.exports = { stripeWebhookRoutes: router };

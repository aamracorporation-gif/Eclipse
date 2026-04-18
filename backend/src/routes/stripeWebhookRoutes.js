const express = require('express');
const { webhookHandler } = require('../controllers/stripeController');

const router = express.Router();

router.post('/webhook', express.raw({ type: 'application/json' }), webhookHandler);

module.exports = { stripeWebhookRoutes: router };

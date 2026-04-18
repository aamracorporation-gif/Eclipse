const express = require('express');
const { authMiddleware, requireRole } = require('../middlewares/auth');
const { createIntent } = require('../controllers/paymentController');

const router = express.Router();

router.post('/create-intent', authMiddleware, requireRole(['attendee', 'client', 'CLIENT']), createIntent);

module.exports = { paymentRoutes: router };

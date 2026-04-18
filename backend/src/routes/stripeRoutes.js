const express = require('express');
const { authMiddleware, requireRole } = require('../middlewares/auth');
const { createAccount, onboardingLink, accountStatus } = require('../controllers/stripeController');

const router = express.Router();

router.post('/create-account', authMiddleware, requireRole(['organizer', 'ORGANIZER']), createAccount);
router.post('/onboarding-link', authMiddleware, requireRole(['organizer', 'ORGANIZER']), onboardingLink);
router.get('/account-status', authMiddleware, requireRole(['organizer', 'ORGANIZER']), accountStatus);

module.exports = { stripeRoutes: router };

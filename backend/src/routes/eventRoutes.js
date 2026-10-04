const express = require('express');
const { authMiddleware, requireRole } = require('../middlewares/auth');
const { create, list, update, remove } = require('../controllers/eventController');

const { requireReadyOrganizer } = require('../middlewares/organizerReady');

const router = express.Router();

router.get('/', list);
router.post('/', authMiddleware, requireRole(['organizer', 'ORGANIZER']), requireReadyOrganizer, create);
router.put('/:id', authMiddleware, requireRole(['organizer', 'ORGANIZER']), requireReadyOrganizer, update);
router.delete('/:id', authMiddleware, requireRole(['organizer', 'ORGANIZER']), requireReadyOrganizer, remove);

module.exports = { eventRoutes: router };

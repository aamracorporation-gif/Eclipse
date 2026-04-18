const express = require('express');
const { authMiddleware, requireRole } = require('../middlewares/auth');
const { create, list, update, remove } = require('../controllers/eventController');

const router = express.Router();

router.get('/', list);
router.post('/', authMiddleware, requireRole(['organizer', 'ORGANIZER']), create);
router.put('/:id', authMiddleware, requireRole(['organizer', 'ORGANIZER']), update);
router.delete('/:id', authMiddleware, requireRole(['organizer', 'ORGANIZER']), remove);

module.exports = { eventRoutes: router };

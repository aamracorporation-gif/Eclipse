const { Router } = require('express');
const { authMiddleware, requireRole } = require('../middlewares/auth');
const { deleteOrganizerAccount } = require('../controllers/organizerController');

const organizerRoutes = Router();

organizerRoutes.delete('/delete-account', authMiddleware, requireRole(['organizer', 'admin']), deleteOrganizerAccount);

module.exports = { organizerRoutes };


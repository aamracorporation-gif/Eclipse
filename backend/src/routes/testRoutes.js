const { Router } = require('express');
const { getTest } = require('../controllers/testController');

const testRoutes = Router();

testRoutes.get('/', getTest);

module.exports = { testRoutes };


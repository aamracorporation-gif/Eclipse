/**
 * server.js — Railway entry point
 * 
 * Imports and starts the Express app from backend/src/app.js
 * This ensures Railway deploys the correct backend code.
 */

'use strict';

const path = require('path');

// Change to backend directory so relative requires work
process.chdir(path.join(__dirname, 'backend'));

// Import the app factory
const { createApp } = require('./src/app');

// Create and start the app
const app = createApp();

const PORT = Number(process.env.PORT) || 8081;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});

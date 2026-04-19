/**
 * server.js — Railway entry point
 *
 * Changes the working directory to `backend/` so that all relative
 * require() calls inside the Express app resolve correctly, then
 * starts the existing Express server.
 */

'use strict';

const path = require('path');

// Move into the backend directory so dotenv, relative requires, etc. all work.
process.chdir(path.join(__dirname, 'backend'));

// Boot the Express server.
// Use path.join(__dirname, ...) because __dirname is still the repo root
// even after chdir — this ensures the require resolves correctly.
require(path.join(__dirname, 'backend', 'src', 'index.js'));

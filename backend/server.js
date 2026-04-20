const { env } = require('./src/config/env');
const { createApp } = require('./src/app');

// Entry point del backend para Railway/producción y desarrollo local.
const app = createApp();

const server = app.listen(env.port, '0.0.0.0', () => {
  process.stdout.write(`Backend listening on port ${env.port}\n`);
});

function shutdown(signal) {
  // Cierre limpio para evitar conexiones colgadas en despliegues.
  process.stdout.write(`Received ${signal}, shutting down...\n`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

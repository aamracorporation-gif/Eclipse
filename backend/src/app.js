const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { env } = require('./config/env');
const { errorHandler } = require('./middlewares/errorHandler');
const { authRoutes } = require('./routes/authRoutes');
const { eventRoutes } = require('./routes/eventRoutes');
const { paymentRoutes } = require('./routes/paymentRoutes');
const { stripeRoutes } = require('./routes/stripeRoutes');
const { stripeWebhookRoutes } = require('./routes/stripeWebhookRoutes');

function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.use(helmet());
  app.use(cors({ origin: true, credentials: true }));
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

  app.get('/health', (req, res) => res.json({ ok: true }));

  app.use('/api/stripe', stripeWebhookRoutes);
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/events', eventRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/stripe', stripeRoutes);

  app.use((req, res) => res.status(404).json({ ok: false, error: 'Not found' }));
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };

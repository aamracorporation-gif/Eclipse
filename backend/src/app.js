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

  // iOS Universal Links - Apple App Site Association
  app.get('/.well-known/apple-app-site-association', (req, res) => {
    const appleTeamId = process.env.APPLE_TEAM_ID || 'PLACEHOLDER';
    const iosBundleId = process.env.IOS_BUNDLE_ID || 'com.achraf.eclipse';

    const appleAppSiteAssociation = {
      applinks: {
        apps: [],
        details: [
          {
            appID: `${appleTeamId}.${iosBundleId}`,
            paths: ['/evento/*', '/api/stripe/callback']
          }
        ]
      },
      webcredentials: {
        apps: [`${appleTeamId}.${iosBundleId}`]
      }
    };

    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(appleAppSiteAssociation);
  });

  // Android App Links - Asset Links
  app.get('/.well-known/assetlinks.json', (req, res) => {
    const androidPackageName = process.env.ANDROID_PACKAGE_NAME || 'com.achraf.eclipse';
    const androidSha256Fingerprints = (process.env.ANDROID_SHA256_CERT_FINGERPRINTS || '').split(',').filter(Boolean);

    const assetLinks = [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: androidPackageName,
          sha256_cert_fingerprints: androidSha256Fingerprints
        }
      }
    ];

    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(assetLinks);
  });

  // Deep Link proxy - Evento compartido
  app.get('/evento/:token', async (req, res) => {
    try {
      const { token } = req.params;
      
      // Proxy hacia Supabase event-share
      const supabaseUrl = process.env.SUPABASE_URL || 'https://your-supabase-url.supabase.co';
      const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';
      
      const response = await fetch(`${supabaseUrl}/functions/v1/event-share/evento/${token}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      
      if (!response.ok) {
        return res.status(response.status).json(data);
      }

      res.status(200).json(data);
    } catch (error) {
      console.error('Error proxying evento request:', error);
      res.status(500).json({ ok: false, error: 'Failed to fetch evento' });
    }
  });

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


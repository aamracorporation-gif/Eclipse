const express = require('express');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8081;

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get('/.well-known/apple-app-site-association', (_req, res) => {
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

app.get('/', (_req, res) => {
  res.status(200).send('Eclipse API viva 🚀');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});

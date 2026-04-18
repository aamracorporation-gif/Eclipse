const { env } = require('./config/env');
const { createApp } = require('./app');

const app = createApp();

app.listen(env.port, () => {
  process.stdout.write(`Backend listening on port ${env.port}\n`);
});

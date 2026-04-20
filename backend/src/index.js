const express = require('express');
const app = express();
app.use(express.json());

const PORT = 8081;

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get('/', (_req, res) => {
  res.status(200).send('Eclipse API viva 🚀');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Servidor escuchando en puerto', PORT);
});

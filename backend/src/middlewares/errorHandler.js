const { ZodError } = require('zod');

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      error: 'Invalid input',
      details: err.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  const status = Number(err?.status || err?.statusCode || 500);
  const message = String(err?.message || 'Internal error');
  return res.status(status).json({ ok: false, error: message });
}

module.exports = { errorHandler };

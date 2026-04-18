const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { supabaseAdmin, supabaseAnon } = require('../services/supabaseService');

function normalizeRole(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  if (lower === 'organizer' || lower === 'organiser') return 'organizer';
  if (lower === 'admin') return 'admin';
  if (lower === 'attendee' || lower === 'client' || lower === 'user') return 'attendee';
  if (lower === 'organizer'.toUpperCase().toLowerCase()) return 'organizer';
  if (lower === 'client'.toUpperCase().toLowerCase()) return 'attendee';
  return lower;
}

function authMiddleware(req, res, next) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token) {
    return res.status(401).json({ ok: false, error: 'Missing Authorization token' });
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret);
    const userId = String(payload?.sub || '');
    const role = String(payload?.role || '');
    if (!userId || !role) return res.status(401).json({ ok: false, error: 'Invalid token' });
    req.auth = { userId, role: normalizeRole(role) };
    return next();
  } catch {}

  return Promise.resolve()
    .then(async () => {
      const { data: userData, error: userError } = await supabaseAnon.auth.getUser(token);
      if (userError || !userData?.user?.id) return null;
      const userId = String(userData.user.id);

      let role = '';
      try {
        const { data: profile, error: profileError } = await supabaseAdmin
          .from('profiles')
          .select('role')
          .eq('id', userId)
          .maybeSingle();
        if (profileError) throw profileError;
        role = String(profile?.role || '');
      } catch {
        role = String(userData.user.user_metadata?.role || userData.user.app_metadata?.role || '');
      }

      return { userId, role: normalizeRole(role) };
    })
    .then((auth) => {
      if (!auth?.userId) return res.status(401).json({ ok: false, error: 'Invalid token' });
      req.auth = auth;
      return next();
    })
    .catch(() => res.status(401).json({ ok: false, error: 'Invalid token' }));
}

function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return function roleMiddleware(req, res, next) {
    const role = normalizeRole(req.auth?.role);
    if (!role) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    const allowedNorm = allowed.map(normalizeRole).filter(Boolean);
    if (!allowedNorm.includes(role)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    return next();
  };
}

module.exports = { authMiddleware, requireRole };

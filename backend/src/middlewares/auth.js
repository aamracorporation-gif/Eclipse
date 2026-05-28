const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const { env } = require('../config/env');
const { supabaseAdmin, supabaseAnon } = require('../services/supabaseService');

function getSupabaseIssuer() {
  const base = String(env.supabaseUrl || '').replace(/\/$/, '');
  return base ? `${base}/auth/v1` : '';
}

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

function isUuid(input) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(input || ''));
}

function getBearerToken(req) {
  const header = String(req.headers.authorization || req.headers.Authorization || '');
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
}

function sendAuthError(res, status, code, message) {
  return res.status(status).json({ ok: false, error: message, code });
}

// Nota: en tokens de Supabase, el claim `role` suele ser `authenticated` (rol de Postgres),
// no el rol de negocio de la app. El rol de la app vive típicamente en `user_metadata.role`
// y/o en `profiles.role`. Este middleware valida firma + iss + aud + exp y normaliza roles.

async function fallbackValidateWithSupabase(token) {
  try {
    const { data: userData, error: userError } = await supabaseAnon.auth.getUser(token);
    if (userError || !userData?.user?.id) return null;
    const userId = String(userData.user.id || '');
    if (!isUuid(userId)) return null;

    const metaRole = normalizeRole(userData.user.user_metadata?.role || userData.user.app_metadata?.role || '');
    const roleFromDb = await resolveUserRoleFromProfiles(userId, token);
    const safeMetaRole = metaRole === 'admin' || metaRole === 'organizer' ? 'attendee' : metaRole;
    const role = roleFromDb || safeMetaRole || 'attendee';
    return { userId, role };
  } catch {
    return null;
  }
}

async function resolveUserRoleFromProfiles(userId, token) {
  try {
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();
    if (profileError) throw profileError;
    return normalizeRole(profile?.role || '');
  } catch {
    try {
      const jwtToken = String(token || '').trim();
      if (!jwtToken) return '';
      const scoped = createClient(env.supabaseUrl, env.supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${jwtToken}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: profile, error } = await scoped.from('profiles').select('role').eq('id', userId).maybeSingle();
      if (error) throw error;
      return normalizeRole(profile?.role || '');
    } catch {
      return '';
    }
  }
}

function authMiddleware(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return sendAuthError(res, 401, 'MISSING_AUTH', 'Missing Authorization token');
  }

  try {
    const issuer = getSupabaseIssuer();
    const payload = jwt.verify(token, env.jwtSecret, {
      algorithms: ['HS256'],
      issuer: issuer || undefined,
      audience: 'authenticated',
      clockTolerance: 10,
    });

    const userId = String(payload?.sub || payload?.user_id || '');
    if (!isUuid(userId)) return sendAuthError(res, 401, 'INVALID_SUB', 'Invalid token');

    const metaRole = normalizeRole(payload?.user_metadata?.role || payload?.app_metadata?.role || '');
    const roleFromClaim = normalizeRole(payload?.role || '');
    const candidate = metaRole || (roleFromClaim === 'authenticated' || roleFromClaim === 'anon' ? '' : roleFromClaim);

    return Promise.resolve()
      .then(async () => {
        const roleFromDb = await resolveUserRoleFromProfiles(userId, token);
        const safeCandidate = candidate === 'admin' || candidate === 'organizer' ? 'attendee' : candidate;
        const role = roleFromDb || safeCandidate || 'attendee';
        req.auth = { userId, role };
        return next();
      })
      .catch(() => sendAuthError(res, 401, 'INVALID_TOKEN', 'Invalid token'));
  } catch (err) {
    const name = String(err?.name || '');
    if (name === 'TokenExpiredError') {
      return sendAuthError(res, 401, 'TOKEN_EXPIRED', 'Token expired');
    }
    if (name === 'NotBeforeError') {
      return sendAuthError(res, 401, 'TOKEN_NOT_ACTIVE', 'Token not active');
    }
    if (name === 'JsonWebTokenError') {
      const msg = String(err?.message || '');
      if (msg.toLowerCase().includes('jwt malformed')) {
        return sendAuthError(res, 401, 'MALFORMED_TOKEN', 'Malformed token');
      }
      const lower = msg.toLowerCase();
      const canFallback =
        lower.includes('invalid signature') || lower.includes('jwt audience invalid') || lower.includes('jwt issuer invalid');

      if (!canFallback) return sendAuthError(res, 401, 'INVALID_TOKEN', 'Invalid token');

      return Promise.resolve()
        .then(async () => {
          const auth = await fallbackValidateWithSupabase(token);
          if (!auth?.userId) return false;
          req.auth = auth;
          next();
          return true;
        })
        .then((ok) => {
          if (ok) return;
          if (lower.includes('invalid signature')) return sendAuthError(res, 401, 'INVALID_SIGNATURE', 'Invalid token signature');
          if (lower.includes('jwt audience invalid')) return sendAuthError(res, 401, 'INVALID_AUD', 'Invalid token audience');
          if (lower.includes('jwt issuer invalid')) return sendAuthError(res, 401, 'INVALID_ISS', 'Invalid token issuer');
          return sendAuthError(res, 401, 'INVALID_TOKEN', 'Invalid token');
        })
        .catch(() => sendAuthError(res, 401, 'INVALID_TOKEN', 'Invalid token'));
    }
    return sendAuthError(res, 401, 'INVALID_TOKEN', 'Invalid token');
  }
}

function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return function roleMiddleware(req, res, next) {
    const role = normalizeRole(req.auth?.role);
    if (!role) return sendAuthError(res, 401, 'UNAUTHORIZED', 'Unauthorized');
    const allowedNorm = allowed.map(normalizeRole).filter(Boolean);
    if (!allowedNorm.includes(role)) {
      return sendAuthError(res, 403, 'FORBIDDEN', 'Forbidden');
    }
    return next();
  };
}

module.exports = { authMiddleware, requireRole };

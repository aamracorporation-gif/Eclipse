const { z } = require('zod');
const { asyncHandler } = require('../utils/asyncHandler');
const { supabaseAnon } = require('../services/supabaseService');

const registerSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  role: z.enum(['CLIENT', 'ORGANIZER']),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

const register = asyncHandler(async (req, res) => {
  const input = registerSchema.parse(req.body);
  const role = input.role === 'ORGANIZER' ? 'organizer' : 'attendee';

  const { data, error } = await supabaseAnon.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: {
        full_name: input.name,
        role,
      },
    },
  });

  if (error) {
    const msg = String(error.message || '');
    const lower = msg.toLowerCase();
    // Preserve Supabase's abuse controls and email verification requirements.
    // Public signup must never fall back to privileged, auto-confirmed creation.
    if (error.status === 429 || lower.includes('rate limit') ||
        ['over_email_send_rate_limit', 'over_request_rate_limit'].includes(error.code)) {
      return res.status(429).json({
        ok: false,
        code: 'SIGNUP_RATE_LIMITED',
        error: 'Demasiados intentos de registro. Espera antes de volver a intentarlo.',
      });
    }

    const status = lower.includes('already') ? 409 : 400;
    return res.status(status).json({ ok: false, error: msg || 'Failed to register' });
  }

  const userId = String(data?.user?.id || '');
  const accessToken = String(data?.session?.access_token || '');

  return res.status(201).json({
    ok: true,
    user: { id: userId, email: data?.user?.email || input.email, role },
    access_token: accessToken || null,
    requires_email_verification: !accessToken,
  });
});

const login = asyncHandler(async (req, res) => {
  const input = loginSchema.parse(req.body);
  const { data, error } = await supabaseAnon.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });

  if (error) return res.status(401).json({ ok: false, error: error.message || 'Invalid credentials' });

  return res.json({
    ok: true,
    user: { id: data?.user?.id || null, email: data?.user?.email || input.email },
    access_token: data?.session?.access_token || null,
    refresh_token: data?.session?.refresh_token || null,
    expires_in: data?.session?.expires_in || null,
  });
});

module.exports = { register, login };

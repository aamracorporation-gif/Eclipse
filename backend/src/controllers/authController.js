const { z } = require('zod');
const { asyncHandler } = require('../utils/asyncHandler');
const { supabaseAdmin, supabaseAnon } = require('../services/supabaseService');

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
    if (lower.includes('rate limit')) {
      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true,
        user_metadata: {
          full_name: input.name,
          role,
        },
      });
      if (createError) {
        return res.status(400).json({ ok: false, error: createError.message || msg || 'Failed to register' });
      }

      const { data: sessionData } = await supabaseAnon.auth.signInWithPassword({
        email: input.email,
        password: input.password,
      });

      const accessToken = String(sessionData?.session?.access_token || '');
      return res.status(201).json({
        ok: true,
        user: { id: String(created?.user?.id || ''), email: created?.user?.email || input.email, role },
        access_token: accessToken || null,
        requires_email_verification: !accessToken,
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

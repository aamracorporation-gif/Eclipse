const { supabaseAdmin } = require('../services/supabaseService');

function isOrganizerReady(profile) {
  return !!profile && profile.role === 'organizer' && !profile.is_suspended &&
    profile.verification_status === 'verified' && !!profile.stripe_account_id &&
    profile.stripe_onboarding_completed === true && profile.stripe_charges_enabled === true;
}

async function requireReadyOrganizer(req, res, next) {
  try {
    const { data, error } = await supabaseAdmin.from('profiles')
      .select('role,verification_status,is_suspended,stripe_account_id,stripe_onboarding_completed,stripe_charges_enabled')
      .eq('id', req.auth.userId).maybeSingle();
    if (error) throw error;
    if (!isOrganizerReady(data)) return res.status(403).json({ ok: false, code: 'ORGANIZER_NOT_READY', error: 'Completa la verificación y Stripe antes de gestionar eventos.' });
    return next();
  } catch {
    return res.status(503).json({ ok: false, code: 'PROFILE_UNAVAILABLE', error: 'No se pudo comprobar el acceso. Inténtalo de nuevo.' });
  }
}
module.exports = { isOrganizerReady, requireReadyOrganizer };

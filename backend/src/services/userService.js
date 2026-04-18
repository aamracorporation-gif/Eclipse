const { supabaseAdmin } = require('./supabaseService');

async function getProfileById(id) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, email, role, stripe_account_id, stripe_onboarding_completed')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function setStripeAccountForUser(userId, stripeAccountId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({
      stripe_account_id: stripeAccountId,
      stripe_account_type: 'express',
      stripe_onboarding_completed: false,
      stripe_details_submitted: false,
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
    })
    .eq('id', userId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function setOnboardingCompletedByUserId(userId, completed) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ stripe_onboarding_completed: Boolean(completed) })
    .eq('id', userId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function setOnboardingCompletedByStripeAccountId(stripeAccountId, completed) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({ stripe_onboarding_completed: Boolean(completed) })
    .eq('stripe_account_id', stripeAccountId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

module.exports = {
  getProfileById,
  setStripeAccountForUser,
  setOnboardingCompletedByUserId,
  setOnboardingCompletedByStripeAccountId,
};

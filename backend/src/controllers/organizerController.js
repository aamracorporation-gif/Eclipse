const { asyncHandler } = require('../utils/asyncHandler');
const { getProfileById } = require('../services/userService');
const { stripe } = require('../services/stripeService');
const { supabaseAdmin } = require('../services/supabaseService');

const deleteOrganizerAccount = asyncHandler(async (req, res) => {
  const userId = req.auth.userId;

  const profile = await getProfileById(userId);
  if (!profile) return res.status(404).json({ ok: false, error: 'User not found' });

  const stripeAccountId = String(profile.stripe_account_id || '');
  if (stripeAccountId) {
    await stripe.accounts.del(stripeAccountId);
  }

  await supabaseAdmin.rpc('admin_purge_user_data', { p_user_id: userId });
  await supabaseAdmin.auth.admin.deleteUser(userId);

  return res.json({ ok: true });
});

module.exports = { deleteOrganizerAccount };


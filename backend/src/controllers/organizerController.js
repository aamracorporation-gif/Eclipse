const { asyncHandler } = require('../utils/asyncHandler');
const { deleteStripeAccountForUser } = require('../services/paymentService');
const { supabaseAdmin } = require('../services/supabaseService');

const deleteOrganizerAccount = asyncHandler(async (req, res) => {
  const userId = req.auth.userId;
  await deleteStripeAccountForUser(userId);

  await supabaseAdmin.rpc('admin_purge_user_data', { p_user_id: userId });
  await supabaseAdmin.auth.admin.deleteUser(userId);

  return res.json({ ok: true });
});

module.exports = { deleteOrganizerAccount };


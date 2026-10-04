const test = require('node:test');
const assert = require('node:assert/strict');
const { supabaseAdmin } = require('../src/services/supabaseService');
const { isOrganizerReady, requireReadyOrganizer } = require('../src/middlewares/organizerReady');
const ready = { role: 'organizer', verification_status: 'verified', is_suspended: false, stripe_account_id: 'acct_test', stripe_onboarding_completed: true, stripe_charges_enabled: true };
test('server denies incomplete, suspended or wrong-role organizers', () => {
  assert.equal(isOrganizerReady(ready),true);
  for (const patch of [{role:'attendee'},{verification_status:'pending_verification'},{is_suspended:true},{stripe_account_id:null},{stripe_onboarding_completed:false},{stripe_charges_enabled:false}]) assert.equal(isOrganizerReady({...ready,...patch}),false);
});
test('middleware fails closed on query errors and only calls next for ready profile', async () => {
  for (const result of [{data:ready,error:null},{data:{...ready,stripe_onboarding_completed:false},error:null},{data:null,error:new Error('offline')}]) {
    supabaseAdmin.from = () => ({ select: () => ({ eq: () => ({maybeSingle:async()=>result}) }) });
    let status=200,continued=false;
    const res={status(n){status=n;return this;},json(body){return body;}};
    await requireReadyOrganizer({auth:{userId:'test'}},res,()=>{continued=true;});
    assert.equal(continued,!result.error && isOrganizerReady(result.data));
    assert.equal(status,result.error?503:isOrganizerReady(result.data)?200:403);
  }
});

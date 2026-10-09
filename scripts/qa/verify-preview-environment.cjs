process.env.ECLIPSE_BUILD_ENV = 'staging';
require('../buildEnvironment.cjs').validateBuildEnvironment();
console.log('Verified staging Supabase, test Stripe, map configuration and staging API.');

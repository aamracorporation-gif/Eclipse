import fs from 'fs';
import path from 'path';

const read = (relativePath: string) =>
  fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

describe('release security regressions', () => {
  test('the mobile client cannot bootstrap an administrator by email', () => {
    const clientFiles = [
      'app/(creator)/index.tsx',
      'app/(creator)/admin-verification.tsx',
      'app/(creator)/_layout.tsx',
      'app/(creator)/manage-events.tsx',
      'app/(creator)/scan.tsx',
      'app/(tabs)/profile.tsx',
    ];

    for (const file of clientFiles) {
      const source = read(file);
      expect(source).not.toContain('bootstrap_set_me_admin');
      expect(source).not.toContain('EXPO_PUBLIC_ADMIN_EMAIL');
      expect(source).not.toContain('aamracorporation@gmail.com');
    }
  });

  test('wallet checkout does not send prices, fees, user ids, or QR values', () => {
    const eventScreen = read('app/(tabs)/event/[id].tsx');
    const walletContext = read('lib/WalletContext.tsx');

    expect(walletContext).toContain("rpc('buy_ticket_with_credito_v2'");
    expect(eventScreen).toContain('p_discount_code_id: appliedDiscount?.id ?? null');
    expect(eventScreen).not.toContain('p_total_price: totalPrice');
    expect(eventScreen).not.toContain('p_service_fee: serviceFeeForPurchase');
    const ticketCheckout = walletContext.slice(
      walletContext.indexOf('const buyTicketWithCredit'),
      walletContext.indexOf('const buyVipWithCredit'),
    );
    expect(ticketCheckout).not.toContain('p_user_id');
  });

  test('wallet checkout migration locks pricing and revokes legacy RPCs', () => {
    const sql = read(
      'supabase/migrations/20260915120000_remove_admin_bootstrap_and_secure_wallet_checkout.sql',
    );

    expect(sql).toContain('DROP FUNCTION IF EXISTS public.bootstrap_set_me_admin(text)');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('v_unit_price_cents := round(v_event.ticket_price * 100)');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.buy_ticket_with_credito(');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
  });

  test('mobile screens cannot invoke destructive maintenance RPCs', () => {
    const clientSource = [
      read('app/(tabs)/tickets.tsx'),
      read('app/my-resales.tsx'),
      read('app/(creator)/index.tsx'),
    ].join('\n');
    const sql = read(
      'supabase/migrations/20260915121000_restrict_destructive_rpcs_and_record_discounts.sql',
    );

    expect(clientSource).not.toContain("rpc('purge_expired_tickets_and_resales'");
    expect(clientSource).not.toContain("rpc('cleanup_old_events'");
    expect(sql).toContain('record_fulfilled_payment_discount');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.cleanup_old_events()');
  });

  test('registration cannot bypass email confirmation through a service-role function', () => {
    const registration = read('app/(auth)/register.tsx');
    const retiredEndpoint = read('supabase/functions/register-user-fallback/index.ts');
    const supportConfig = read('supabase/functions/send-support-email/config.toml');
    const supportFunction = read('supabase/functions/send-support-email/index.ts');

    expect(registration).not.toContain('/functions/v1/register-user-fallback');
    expect(registration).not.toContain('EXPO_PUBLIC_DEV_BYPASS_EMAIL_RATE_LIMIT');
    expect(retiredEndpoint).not.toContain('auth.admin.createUser');
    expect(retiredEndpoint).toContain('status: 410');
    expect(supportConfig).toContain('verify_jwt = true');
    expect(supportFunction).toContain('client.auth.getUser()');
  });

  test('push delivery can only be dispatched by the service role', () => {
    const walletContext = read('lib/WalletContext.tsx');
    const sendPush = read('supabase/functions/send-push/index.ts');

    expect(walletContext).not.toContain("invokeEdgeFunction('send-push'");
    expect(sendPush).toContain('authorization !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`');
    expect(sendPush).toContain('status: 403');
  });
});

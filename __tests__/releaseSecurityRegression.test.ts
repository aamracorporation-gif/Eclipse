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
    const discountSql = read(
      'supabase/migrations/20260915121000_restrict_destructive_rpcs_and_record_discounts.sql',
    );
    const maintenanceSql = read(
      'supabase/migrations/20260915121100_restrict_maintenance_rpcs.sql',
    );

    expect(clientSource).not.toContain("rpc('purge_expired_tickets_and_resales'");
    expect(clientSource).not.toContain("rpc('cleanup_old_events'");
    expect(discountSql).toContain('record_fulfilled_payment_discount');
    expect(maintenanceSql).toContain('REVOKE ALL ON FUNCTION public.cleanup_old_events()');
  });

  test('ticket scanners bind identity and serialize ticket consumption', () => {
    const scannerSql = read(
      'supabase/migrations/20260913000000_harden_atomic_ticket_scanning.sql',
    );
    const retiredSql = read(
      'supabase/migrations/20260915121200_retire_legacy_ticket_scanners.sql',
    );

    expect(scannerSql).toContain('user_id=auth.uid()');
    expect(scannerSql).toContain("permissions ? 'scan'");
    expect(scannerSql).toContain('worker_event_assignments');
    expect(scannerSql.match(/FOR UPDATE/g)?.length).toBeGreaterThanOrEqual(2);
    expect(retiredSql).toContain('REVOKE ALL ON FUNCTION public.validate_ticket_qr_v3(text,text,uuid)');
  });

  test('privileged database routines use an authenticated allowlist', () => {
    const allowlistSql = read(
      'supabase/migrations/20260915121400_allowlist_security_definer_rpcs.sql',
    );

    expect(allowlistSql).toContain('FROM PUBLIC, anon, authenticated');
    expect(allowlistSql).toContain('TO service_role');
    expect(allowlistSql).toContain(
      'GRANT EXECUTE ON FUNCTION public.buy_ticket_with_credito_v2',
    );
  });

  test('resale cancellation and notification bulk-read stay server-authoritative', () => {
    const walletContext = read('lib/WalletContext.tsx');
    const notificationContext = read('lib/NotificationContext.tsx');
    const rpcSql = read(
      'supabase/migrations/20260915121500_restore_secure_user_rpcs.sql',
    );

    expect(walletContext).not.toContain("from('resale_listings')\n          .delete()");
    expect(notificationContext).not.toContain("from('notifications')\n          .update({ read: true");
    expect(rpcSql).toContain('p_user_id IS DISTINCT FROM auth.uid()');
    expect(rpcSql).toContain('seller_id = auth.uid()');
  });

  test('public profile reads use a minimal card instead of the private profile row', () => {
    const eventContext = read('lib/EventContext.tsx');
    const resaleScreen = read('app/(tabs)/resale.tsx');
    const ticketsScreen = read('app/(tabs)/tickets.tsx');
    const registration = read('app/(auth)/register.tsx');
    const profileSql = read(
      'supabase/migrations/20260915122000_secure_profiles_and_public_cards.sql',
    );

    for (const source of [eventContext, resaleScreen, ticketsScreen, registration]) {
      expect(source).toContain('public_profile_cards');
    }
    expect(resaleScreen).not.toContain(".select('id, full_name, email')");
    expect(profileSql).toContain('DROP POLICY IF EXISTS "Public profiles are viewable by everyone"');
    expect(profileSql).toContain('REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated');
    expect(profileSql).not.toContain('aamracorporation@gmail.com');
  });

  test('resale browsing never reads ticket secrets', () => {
    const resaleScreen = read('app/(tabs)/resale.tsx');
    const ticketsScreen = read('app/(tabs)/tickets.tsx');
    const resaleSql = read(
      'supabase/migrations/20260915122100_secure_ticket_visibility_and_resale_cards.sql',
    );

    expect(resaleScreen).toContain("from('public_resale_cards')");
    expect(resaleScreen).not.toContain('ticket:tickets');
    expect(ticketsScreen).toContain("rpc('mark_ticket_wallet_added'");
    expect(resaleSql).toContain('REVOKE ALL ON TABLE public.tickets FROM PUBLIC, anon, authenticated');
    expect(resaleSql).toContain('DROP POLICY IF EXISTS "Public can view tickets in active resale"');
  });

  test('worker cash sales are priced and stocked by an authenticated RPC', () => {
    const workerSale = read('app/(worker)/sell.tsx');
    const saleSql = read(
      'supabase/migrations/20260915122200_authoritative_worker_cash_sales.sql',
    );

    expect(workerSale).toContain("rpc('sell_tickets_manual_v2'");
    expect(workerSale).not.toContain("from('tickets').insert(ticketsToCreate)");
    expect(saleSql).toContain("permissions ? 'sell'");
    expect(saleSql).toContain('worker_event_assignments');
    expect(saleSql).toContain('FOR UPDATE');
    expect(saleSql).toContain('v_type.price');
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

  test('legacy payment creation endpoint is retired', () => {
    const legacyPayment = read('supabase/functions/create-payment-intent/index.ts');
    const paymentApi = read('lib/payments/api.ts');

    expect(legacyPayment).toContain('status: 410');
    expect(legacyPayment).not.toContain('STRIPE_SECRET_KEY');
    expect(paymentApi).toContain("'create-payment-intent-v2'");
    expect(paymentApi).not.toContain("invokeWithJwtRecovery<CreatePaymentIntentResponse>('create-payment-intent'");
  });
});

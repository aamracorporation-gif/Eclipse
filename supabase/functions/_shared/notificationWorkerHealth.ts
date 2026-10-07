import { runNotificationDispatch, type Rpc, type Environment } from './notificationDelivery.ts';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function mustRpc(rpc: Rpc, name: string, args: Record<string, unknown>) {
 const result = await rpc(name, args);
 if (result.error) throw new Error(`NOTIFICATION_RPC_FAILED:${name}`);
 return result.data;
}

/** Runtime health uses an additional service-only RPC and contains no recipient or secret values. */
export async function runNotificationDispatchWithHealth(rpc: Rpc, env: Environment, send: typeof fetch = fetch) {
  const config = { p_push_configured: UUID.test(env('NOTIFICATIONS_EXPO_PROJECT_ID') ?? ''),
    p_email_configured: !!env('RESEND_API_KEY') && !!env('NOTIFICATIONS_FROM_EMAIL') && !/[\r\n]/.test(env('NOTIFICATIONS_FROM_EMAIL') ?? '') };
  await mustRpc(rpc, 'record_notification_worker_tick_v2', { p_status: 'running', ...config });
  try {
    const result = await runNotificationDispatch(rpc, env, send);
    await mustRpc(rpc, 'record_notification_worker_tick_v2', { p_status: result.dispatch,
      p_processed: result.processed, p_receipts: result.receipts, ...config });
    return result;
  } catch (error) {
    // A failed heartbeat must not conceal the original failure or expose provider response data.
    try { await mustRpc(rpc, 'record_notification_worker_tick_v2', { p_status: 'failed', ...config }); } catch { /* Main error still reaches protected handler. */ }
    throw error;
  }
}

export const BOX_OFFICE_FEATURE = 'box_office_monthly';
export const BOX_OFFICE_PRICE_CENTS = 5000;

/** Do not grant access for an unpaid, trial, paused, or differently priced subscription. */
export function subscriptionEntitlement(subscription: any) {
  const items = subscription.items?.data || [];
  const item = items[0];
  const price = item?.price;
  const invoice = subscription.latest_invoice;
  const validPlan = subscription.metadata?.feature === BOX_OFFICE_FEATURE && items.length === 1 &&
    item.quantity === 1 && price?.unit_amount === BOX_OFFICE_PRICE_CENTS && price.currency === 'eur' &&
    price.recurring?.interval === 'month' && price.recurring?.interval_count === 1;
  const paid = invoice && typeof invoice === 'object' && invoice.status === 'paid' &&
    invoice.currency === 'eur' && invoice.total >= BOX_OFFICE_PRICE_CENTS;
  const periodEnd = Number(item?.current_period_end || subscription.current_period_end || 0);
  // The current customer portal uses cancel_at, even when cancellation is at period end.
  const cancelAt = Number(subscription.cancel_at || 0);
  const end = cancelAt > 0 ? Math.min(periodEnd, cancelAt) : periodEnd;
  const allowed = validPlan && paid && subscription.status === 'active' && !subscription.pause_collection;
  return {
    status: validPlan ? (subscription.pause_collection ? 'paused' : subscription.status) : 'invalid_plan',
    paidThrough: allowed && end > 0 ? new Date(end * 1000).toISOString() : null,
    cancelAtPeriodEnd: !!subscription.cancel_at_period_end || cancelAt > 0,
  };
}

export function subscriptionIdFromEvent(event: any): string | null {
  const obj = event.data?.object;
  if (!obj) return null;
  if (event.type.startsWith('customer.subscription.')) return obj.id;
  const id = obj.subscription || obj.parent?.subscription_details?.subscription;
  return typeof id === 'string' ? id : id?.id || null;
}

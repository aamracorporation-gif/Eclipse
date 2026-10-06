/** @jest-environment node */
import { calculateDiscountCents, discountAppliesToProduct, discountError, discountSelectionKey, type DiscountRule } from '../supabase/functions/_shared/discountPolicy';
const base: DiscountRule = { id: 'code', event_id: 'event', discount_type: 'percentage', discount_value: 20, is_active: true, min_tickets: 1 };
it('legacy coupons never silently expand to VIP tables', () => {
  expect(discountAppliesToProduct(base, 'event_ticket', 'ticket')).toBe(true);
  expect(discountAppliesToProduct(base, 'vip_table', 'vip')).toBe(false);
});
it.each(['tickets', 'vip_tables', 'all', 'selected'] as const)('scope %s matches only permitted products', applicability => {
  const rule = { ...base, applicability, ticket_type_ids: ['one'], vip_reservado_ids: ['table'] };
  expect(discountAppliesToProduct(rule, 'event_ticket', 'one')).toBe(applicability !== 'vip_tables');
  expect(discountAppliesToProduct(rule, 'vip_table', 'table')).toBe(applicability !== 'tickets');
  expect(discountAppliesToProduct(rule, 'event_ticket', 'other')).toBe(applicability === 'all' || applicability === 'tickets');
  expect(discountAppliesToProduct(rule, 'vip_table', 'other')).toBe(applicability === 'all' || applicability === 'vip_tables');
});
it('fixed amount is applied once to the complete table, capped to subtotal', () => {
  expect(calculateDiscountCents(30000, { discount_type: 'fixed', discount_value: 50 })).toBe(5000);
  expect(calculateDiscountCents(30000, { discount_type: 'fixed', discount_value: 500 })).toBe(30000);
});
it.each([[999, 15, 150], [30000, 20, 6000], [30000, 100, 30000]])('integer cents %s at %s%% = %s', (cents, value, saving) => {
  expect(calculateDiscountCents(cents, { discount_type: 'percentage', discount_value: value })).toBe(saving);
});
it.each([-1, 0, 101, NaN, Infinity])('rejects invalid percentage %s', value => {
  expect(() => calculateDiscountCents(1000, { discount_type: 'percentage', discount_value: value })).toThrow();
});
it('minimum quantity counts one table, not its guest capacity', () => {
  expect(discountError({ ...base, applicability: 'vip_tables', min_tickets: 2 }, 'event', 'vip_table', 'table', 1)).toContain('mínimo');
  expect(discountError({ ...base, applicability: 'vip_tables' }, 'event', 'vip_table', 'table', 6)).toContain('Cantidad');
});
it.each([
  { valid_until: '2026-10-06T19:00:00Z' }, { valid_from: '2099-01-01T00:00:00Z' },
  { valid_until: 'invalid' }, { is_active: false }, { max_uses: 1, uses_count: 1 }, { event_id: 'other' },
])('rejects invalid rule %j', change => {
  expect(discountError({ ...base, ...change }, 'event', 'event_ticket', 'ticket', 1, Date.parse('2026-10-06T20:00:00Z'))).not.toBeNull();
});
it('equivalent time zones compare instants, not strings', () => {
  expect(discountError({ ...base, valid_until: '2026-10-06T22:00:00+02:00' }, 'event', 'event_ticket', 'ticket', 1, Date.parse('2026-10-06T19:30:00Z'))).toBeNull();
});
it('selection binding differs across product, event, quantity and checkout type', () => {
  const key = discountSelectionKey('event', 'event_ticket', 'ticket', 2);
  expect(new Set([key, discountSelectionKey('other', 'event_ticket', 'ticket', 2), discountSelectionKey('event', 'event_ticket', 'other', 2),
    discountSelectionKey('event', 'event_ticket', 'ticket', 1), discountSelectionKey('event', 'vip_table', 'ticket', 2)]).size).toBe(5);
});

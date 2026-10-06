/** @jest-environment node */
import React from 'react';
import { DiscountCodeField } from '../components/DiscountCodeField';
import { supabase } from '../lib/supabase';
const { act, create } = require('react-test-renderer');
jest.mock('../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('react-native', () => ({ View: 'View', Text: 'Text', TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity',
  ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: (value: unknown) => value } }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const rpc = supabase.rpc as jest.Mock;
const rule = { id: 'coupon', discount_type: 'percentage', discount_value: 20 };
const props = { eventId: 'event', kind: 'vip_table' as const, productId: 'table', quantity: 1, value: null,
  onChange: jest.fn(), onCheckingChange: jest.fn() };
let tree: any;
beforeEach(() => { jest.clearAllMocks(); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = undefined; });
async function mount(values = props) { await act(async () => { tree = create(<DiscountCodeField {...values}/>); }); }
async function enter() { await act(async () => { tree.root.findByType('TextInput').props.onChangeText(' vip20 '); }); }
const apply = () => tree.root.findAllByType('TouchableOpacity').find((node: any) => node.props.accessibilityLabel === 'Aplicar código de descuento');
it('VIP control submits its table ID and one unit, not the guest count', async () => {
  rpc.mockResolvedValue({ data: rule, error: null });
  await mount(); await enter(); await act(async () => { await apply().props.onPress(); });
  expect(rpc).toHaveBeenCalledWith('validate_discount_code_for_product', { p_code: 'VIP20', p_event_id: 'event', p_quantity: 1,
    p_ticket_type_id: null, p_vip_reservado_id: 'table' });
  expect(props.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'coupon', value: 20 }));
});
it('late validation cannot follow a different table selection', async () => {
  let finish: (value: unknown) => void = () => {};
  rpc.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await mount(); await enter();
  await act(async () => { apply().props.onPress(); });
  await act(async () => { tree.update(<DiscountCodeField {...props} productId="other-table"/>); });
  await act(async () => { finish({ data: rule, error: null }); });
  expect(props.onChange.mock.calls.every(([value]) => value === null)).toBe(true);
  expect(tree.root.findByType('TextInput').props.value).toBe('');
});
it('rejected code shows an inline error and never applies a reduction', async () => {
  rpc.mockResolvedValue({ data: null, error: { message: 'No válido para esta mesa' } });
  await mount(); await enter(); await act(async () => { await apply().props.onPress(); });
  expect(props.onChange).toHaveBeenLastCalledWith(null);
  expect(JSON.stringify(tree.toJSON())).toContain('No válido para esta mesa');
});
it('a pending validation cannot update state after leaving checkout', async () => {
  let finish: (value: unknown) => void = () => {};
  rpc.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await mount(); await enter(); await act(async () => { apply().props.onPress(); });
  await act(async () => { tree.unmount(); }); tree = undefined;
  props.onChange.mockClear(); await act(async () => { finish({ data: rule, error: null }); });
  expect(props.onChange).not.toHaveBeenCalled();
});

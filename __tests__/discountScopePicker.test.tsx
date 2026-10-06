/** @jest-environment node */
import React, { useState } from 'react';
import { DiscountScopePicker } from '../components/DiscountScopePicker';
import { supabase } from '../lib/supabase';
import type { DiscountScope } from '../supabase/functions/_shared/discountPolicy';
const { act, create } = require('react-test-renderer');
jest.mock('../lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('react-native', () => ({ View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
  ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: (value: unknown) => value } }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const from = supabase.from as jest.Mock;
const onReady = jest.fn(), onSelection = jest.fn();
const catalog = {
  event_ticket_types: [{ id: 'admission-a', name: 'General', price: 15, is_active: true },
    { id: 'admission-b', name: 'Backstage', price: 30, is_active: true }],
  reservados_vip: [{ id: 'table-a', name: 'Mesa seis personas', base_price: 300, is_active: true }],
};
function Harness() {
  const [scope, setScope] = useState<DiscountScope>('selected');
  const [tickets, setTickets] = useState<string[]>([]), [tables, setTables] = useState<string[]>([]);
  return <DiscountScopePicker eventId="event" scope={scope} ticketIds={tickets} vipIds={tables}
    onScope={setScope} onTickets={ids => { setTickets(ids); onSelection('tickets', ids); }}
    onVips={ids => { setTables(ids); onSelection('tables', ids); }} onReady={onReady}/>;
}
let tree: any;
function installCatalog(failure = false) {
  from.mockImplementation((table: keyof typeof catalog) => {
    const chain: any = { select: jest.fn(() => chain), eq: jest.fn(() => chain), is: jest.fn(() => chain),
      order: jest.fn(async () => ({ data: failure ? null : catalog[table], error: failure ? { message: 'offline' } : null })) };
    return chain;
  });
}
beforeEach(() => { jest.clearAllMocks(); installCatalog(); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = undefined; });
const checkboxes = () => tree.root.findAllByType('TouchableOpacity').filter((node: any) => node.props.accessibilityRole === 'checkbox');
async function pressLabel(label: string) {
  await act(async () => { checkboxes().find((node: any) => node.props.accessibilityLabel === label).props.onPress(); });
}
it('loads the actual admission and VIP catalogs and rejects an empty selected scope', async () => {
  await act(async () => { tree = create(<Harness/>); });
  expect(from).toHaveBeenCalledWith('event_ticket_types');
  expect(from).toHaveBeenCalledWith('reservados_vip');
  expect(checkboxes()).toHaveLength(3);
  expect(onReady).toHaveBeenLastCalledWith(false);
});
it('allows multiple admission products plus a VIP table and preserves their distinct IDs', async () => {
  await act(async () => { tree = create(<Harness/>); });
  await pressLabel('Entradas: General'); await pressLabel('Entradas: Backstage');
  await pressLabel('Mesas VIP: Mesa seis personas');
  expect(onSelection).toHaveBeenCalledWith('tickets', ['admission-a', 'admission-b']);
  expect(onSelection).toHaveBeenCalledWith('tables', ['table-a']);
  expect(checkboxes().every((node: any) => node.props.accessibilityState.checked)).toBe(true);
  expect(onReady).toHaveBeenLastCalledWith(true);
  await pressLabel('Entradas: General');
  expect(onSelection).toHaveBeenLastCalledWith('tickets', ['admission-b']);
});
it('an explicit unrestricted preset is valid without selecting IDs', async () => {
  await act(async () => { tree = create(<Harness/>); });
  const presets = tree.root.findAllByType('TouchableOpacity').filter((node: any) => node.props.accessibilityRole === 'radio');
  expect(presets).toHaveLength(4);
  await act(async () => presets[2].props.onPress());
  expect(checkboxes()).toHaveLength(0);
  expect(onReady).toHaveBeenLastCalledWith(true);
});
it('catalog loading failure prevents saving selected products and exposes retry', async () => {
  installCatalog(true);
  await act(async () => { tree = create(<Harness/>); });
  expect(onReady).toHaveBeenLastCalledWith(false);
  expect(checkboxes()).toHaveLength(0);
  expect(JSON.stringify(tree.toJSON())).toContain('Reintentar');
  expect(JSON.stringify(tree.toJSON())).toContain('No se pudieron cargar');
});

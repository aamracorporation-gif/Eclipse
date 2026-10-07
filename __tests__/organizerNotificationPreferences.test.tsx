/** @jest-environment node */
import React from 'react';
import { OrganizerNotificationPreferences, type OrganizerNotificationSettings } from '../components/OrganizerNotificationPreferences';
const { act, create } = require('react-test-renderer');
jest.mock('react-native', () => ({ View: 'View', Text: 'Text', Switch: 'Switch', TouchableOpacity: 'TouchableOpacity', StyleSheet: { create: (x: unknown) => x } }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const change = jest.fn(); let tree: any;
const defaults: OrganizerNotificationSettings = { sales_mode: 'grouped', vip_sales_immediate: false, stock_alerts: true };
async function render(value = defaults, disabled = false) { await act(async () => { tree = create(<OrganizerNotificationPreferences value={value} disabled={disabled} onChange={change} />); }); }
beforeEach(() => { change.mockClear(); });
afterEach(async () => { if (tree) await act(async () => tree.unmount()); tree = undefined; });
it('offers three modes with grouped selected and VIP interruption off', async () => { await render(); const modes=tree.root.findAllByType('TouchableOpacity'); expect(modes).toHaveLength(3);expect(modes[0].props.accessibilityState.selected).toBe(true);expect(tree.root.findAllByType('Switch')[0].props.value).toBe(false); });
it('mode changes send only the specific preference, not a global channel reset', async () => { await render(); await act(async () => tree.root.findAllByType('TouchableOpacity')[1].props.onPress()); expect(change).toHaveBeenCalledWith({sales_mode:'immediate'}); });
it('history-only disables the VIP immediate switch', async () => { await render({...defaults,sales_mode:'off'}); expect(tree.root.findAllByType('Switch')[0].props.disabled).toBe(true); });
it('availability switch is independent of sales mode', async () => { await render({...defaults,sales_mode:'off'});const stock=tree.root.findAllByType('Switch')[1];expect(stock.props.disabled).toBe(false);await act(async () => stock.props.onValueChange(false));expect(change).toHaveBeenCalledWith({stock_alerts:false}); });
it('busy state disables every control', async () => { await render(defaults,true);expect([...tree.root.findAllByType('Switch'),...tree.root.findAllByType('TouchableOpacity')].every((x:any)=>x.props.disabled)).toBe(true); });
it('distinguishes complete VIP tables from guests and sold amount from payout', async () => { await render(); const text=JSON.stringify(tree.toJSON());expect(text).toContain('no como una venta por cada invitado');expect(text).toContain('no el saldo disponible');expect(text).toContain('últimas dos'); });

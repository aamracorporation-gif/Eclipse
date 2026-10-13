import React from 'react';
import { Platform, TouchableOpacity } from 'react-native';
// @ts-expect-error Test renderer types are not included in the native application.
import { create, act } from 'react-test-renderer';
import RegisterScreen from '@/app/(auth)/register';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { ThemedInput } from '@/components/ui/ThemedInput';
import DateTimePicker from '@react-native-community/datetimepicker';


const mockSignup = jest.fn();
const mockShow = jest.fn();
const mockPush = jest.fn();
jest.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ signUp: mockSignup }) }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/edgeFunctions', () => ({ invokeEdgeFunction: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: mockPush }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock('@/components/ui/AppDialog', () => ({ useAppDialog: () => ({ show: mockShow }) }));
jest.mock('@/components/ui/ThemedButton', () => ({ ThemedButton: 'ThemedButton' }));
jest.mock('@/components/ui/ThemedInput', () => ({ ThemedInput: 'ThemedInput' }));
jest.mock('@/components/ui/GlassView', () => ({ GlassView: 'GlassView' }));
jest.mock('@/components/ui/DiscoLoader', () => ({ DiscoLoader: 'DiscoLoader' }));
jest.mock('@/components/ui/VenueLocationPicker', () => ({ VenueLocationPicker: 'VenueLocationPicker' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('expo-location', () => ({ hasServicesEnabledAsync: async () => false }));
jest.mock('@/lib/icons', () => Object.fromEntries(
  ['Mail', 'Lock', 'Eye', 'EyeOff', 'ArrowRight', 'User', 'MapPin', 'Calendar', 'Building2',
    'PartyPopper', 'Edit2', 'RefreshCw', 'Check', 'Building', 'CreditCard'].map(name => [name, () => null])
));

let tree: ReturnType<typeof create>;
const originalPlatform = Platform.OS;
function button(title: string) {
  return tree.root.findAllByType(ThemedButton).find((node: any) => node.props.title === title);
}
function field(placeholder: string) {
  return tree.root.findAllByType(ThemedInput).find((node: any) => node.props.placeholder === placeholder);
}
async function pressLabel(label: string) {
  const target = tree.root.findAllByType(TouchableOpacity).find((node: any) =>
    node.findAll((child: any) => child.props.children === label).length > 0);
  expect(target).toBeDefined();
  await act(async () => { target.props.onPress(); });
}
async function next() {
  expect(button('Siguiente').props.disabled).toBeFalsy();
  await act(async () => { await button('Siguiente').props.onPress(); });
}

beforeEach(async () => {
  jest.clearAllMocks();
  Platform.OS = 'android';
  await act(async () => { tree = create(<RegisterScreen />); });
  await next();
  act(() => {
    field('Nombre').props.onChangeText('Alex');
    field('Apellidos').props.onChangeText('García');
    field('Ciudad').props.onChangeText('Madrid');
    field('País').props.onChangeText('España');
  });
  await next();
  await pressLabel('Seleccionar fecha');
  act(() => tree.root.findByType(DateTimePicker).props.onChange({}, new Date(1995, 0, 1)));
  await next();
  act(() => {
    field('Correo electrónico').props.onChangeText('  Registered@Example.Test  ');
    field('Contraseña').props.onChangeText('NewPassword123!');
    field('Confirmar contraseña').props.onChangeText('NewPassword123!');
  });
  await pressLabel('Términos y Condiciones');
  await pressLabel('Política de Privacidad');
  expect(button('Crear Cuenta').props.disabled).toBeFalsy();
  mockShow.mockClear();
});
afterEach(() => {
  act(() => tree.unmount());
  Platform.OS = originalPlatform;
});

it('accepts a pasted email with outer whitespace and sends one normalized value', async () => {
  mockSignup.mockResolvedValue({ error: null });
  await act(async () => { await button('Crear Cuenta').props.onPress(); });
  expect(mockSignup).toHaveBeenCalledWith('registered@example.test', 'NewPassword123!', expect.objectContaining({ email: 'registered@example.test' }));
  expect(mockShow.mock.calls[0][0].title).toBe('Confirma tu email');
});

it('rejects whitespace inside the email before submitting', async () => {
  act(() => field('Correo electrónico').props.onChangeText('registered @example.test'));
  expect(button('Crear Cuenta').props.disabled).toBe(true);
  expect(mockSignup).not.toHaveBeenCalled();
});

it('does not advance to verification when the normalized email is registered', async () => {
  mockSignup.mockResolvedValue({ error: { code: 'EMAIL_ALREADY_REGISTERED' } });
  await act(async () => { await button('Crear Cuenta').props.onPress(); });
  expect(mockShow.mock.calls[0][0].title).toBe('Este correo ya está registrado');
  expect(button('Ya confirmé mi email')).toBeUndefined();
  act(() => mockShow.mock.calls[0][0].actions[0].onPress());
  expect(mockPush).toHaveBeenCalledWith('/(auth)/login');
});
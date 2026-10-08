// @ts-nocheck Offline review of the actual screens; all account/network effects are mocked by the builder.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import es from '@/src/i18n/locales/es.json';
import Customer from '@/app/(tabs)/profile';
import Organizer from '@/app/(creator)/organizer-profile';
import Workers from '@/app/(creator)/workers/index';
import AddWorker from '@/app/(creator)/workers/add';
import Sell from '@/app/(worker)/sell';
import Dashboard from '@/app/(creator)/index';
import Notifications from '@/app/notifications';
import { creatorTabStyle, customerTabStyle } from './.preview-tabs';
import { User, Ticket, Calendar, BarChart3 } from '@/lib/icons';

i18n.use(initReactI18next).init({ lng: 'es', fallbackLng: 'es', resources: { es: { translation: es } }, interpolation: { escapeValue: false } });
const view = new URLSearchParams(location.search).get('view') || 'organizer';
const component = { customer: Customer, organizer: Organizer, workers: Workers, add: AddWorker, sell: Sell, dashboard: Dashboard }[view];
const Tab = createBottomTabNavigator();
const bottom = Number(new URLSearchParams(location.search).get('inset') || 0);
const metrics = { frame: { x: 0, y: 0, width: innerWidth, height: innerHeight }, insets: { top: 0, right: 0, bottom, left: 0 } };
const names = view === 'customer' ? ['Inicio', 'Mapa', 'Entradas', 'Perfil'] : ['Estadísticas', 'Eventos', 'Acceso', 'Descuentos', 'Perfil'];
const icons = [BarChart3, Calendar, Ticket, Ticket, User];
const Blank = () => <View/>;
createRoot(document.getElementById('root')!).render(<SafeAreaProvider initialMetrics={metrics}>
  <NavigationContainer>
    {view === 'notifications' ? <Notifications/> : view === 'sell' ? <Sell/> : <Tab.Navigator initialRouteName={['customer','organizer'].includes(view) ? 'Perfil' : names[0]} screenOptions={{ headerShown: false, animation: 'none', sceneStyle: { backgroundColor: '#050510' }, tabBarActiveTintColor: '#7C3AED', tabBarInactiveTintColor: '#A1A1AA', tabBarStyle: (view === 'customer' ? customerTabStyle : creatorTabStyle)({ bottom }), tabBarLabelStyle: { paddingBottom: 2, fontSize: 10, fontWeight: '600' } }}>
      {names.map((name, index) => <Tab.Screen name={name} key={name} component={index === (['customer','organizer'].includes(view) ? names.length - 1 : 0) ? component : Blank} options={{ tabBarIcon: ({ color, size }) => { const Icon = index === names.length - 1 ? User : icons[index]; return <Icon size={size} color={color}/>; } }}/>) }
    </Tab.Navigator>}
  </NavigationContainer>
</SafeAreaProvider>);

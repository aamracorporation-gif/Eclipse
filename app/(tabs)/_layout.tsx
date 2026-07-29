import { Tabs } from 'expo-router';
import { Home, Ticket, User, Repeat, Map as MapIcon } from '@/lib/icons';
import { Colors } from '@/constants/Colors';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/theme/styles';

export default function TabLayout() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const paddingV = 6;
  const tabBarHeight = 56 + insets.bottom;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.dark.primary,
        tabBarInactiveTintColor: Colors.dark.textSecondary,
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 0,
          height: tabBarHeight,
          paddingTop: paddingV,
          paddingBottom: insets.bottom + paddingV,
          borderRadius: 22,
          backgroundColor: '#0A0A10',
          borderWidth: 1,
          borderColor: theme.colors.border,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.28,
          shadowRadius: 18,
          elevation: 12,
        },
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: { paddingBottom: 2, fontSize: 10, fontWeight: '600', numberOfLines: 1 },
        tabBarItemStyle: { paddingTop: 2, flex: 1, minWidth: 0 },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ size, color }) => (
            <Home size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="party-map"
        options={{
          title: 'Mapa',
          tabBarIcon: ({ size, color }) => (
            <MapIcon size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="tickets"
        options={{
          title: 'Entradas',
          tabBarIcon: ({ size, color }) => (
            <Ticket size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="resale"
        options={{
          title: t('tabs.resale'),
          tabBarIcon: ({ size, color }) => (
            <Repeat size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ size, color }) => (
            <User size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="event/[id]"
        options={{
          href: null,
          tabBarButton: () => null,
        }}
      />
    </Tabs>
  );
}

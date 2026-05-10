import { Tabs } from 'expo-router';
import { Home, Ticket, User, Repeat, Map as MapIcon } from '@/lib/icons';
import { Colors } from '@/constants/Colors';
import { Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/theme/styles';

export default function TabLayout() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
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
          bottom: 12,
          height: 64 + insets.bottom,
          paddingTop: 10,
          paddingBottom: Math.max(10, insets.bottom),
          borderRadius: 22,
          backgroundColor: 'rgba(10, 10, 16, 0.92)',
          borderWidth: 1,
          borderColor: theme.colors.border,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.28,
          shadowRadius: 18,
          elevation: 12,
        },
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: { paddingBottom: 2 },
        tabBarItemStyle: { paddingTop: 2 },
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
          title: t('home.view_map'),
          href: Platform.OS === 'web' ? undefined : null,
          tabBarIcon: ({ size, color }) => (
            <MapIcon size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="tickets"
        options={{
          title: t('tabs.tickets'),
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
        }}
      />
    </Tabs>
  );
}

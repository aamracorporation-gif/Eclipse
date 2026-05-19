import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { Colors } from '@/constants/Colors';
import { useResponsive } from '@/lib/responsive';

export type AppDialogAction = {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'outline' | 'secondary';
};

export type AppDialogPayload = {
  title: string;
  message: string;
  actions?: AppDialogAction[];
};

type AppDialogContextValue = {
  show: (payload: AppDialogPayload) => void;
  hide: () => void;
};

const AppDialogContext = createContext<AppDialogContextValue | null>(null);

export function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const { horizontalPadding, maxContentWidth, scaleFont } = useResponsive();
  const [dialog, setDialog] = useState<AppDialogPayload | null>(null);

  const hide = useCallback(() => setDialog(null), []);
  const show = useCallback((payload: AppDialogPayload) => setDialog(payload), []);

  const value = useMemo(() => ({ show, hide }), [hide, show]);
  const actions = dialog?.actions?.length ? dialog.actions : [{ label: 'OK', onPress: hide, variant: 'primary' as const }];

  return (
    <AppDialogContext.Provider value={value}>
      {children}
      <Modal visible={!!dialog} transparent animationType="fade" onRequestClose={hide}>
        <View style={styles.overlay}>
          <LinearGradient colors={['rgba(0,0,0,0.78)', 'rgba(0,0,0,0.70)']} style={StyleSheet.absoluteFill} />
          <GlassView
            intensity={18}
            style={[
              styles.card,
              {
                paddingHorizontal: 18,
                paddingVertical: 18,
                marginHorizontal: horizontalPadding,
                maxWidth: Math.min(560, maxContentWidth),
              },
            ]}
          >
            <Text style={[styles.title, { fontSize: scaleFont(18) }]} numberOfLines={2}>
              {dialog?.title || ''}
            </Text>
            <Text style={[styles.message, { fontSize: scaleFont(14) }]}>{dialog?.message || ''}</Text>
            <View style={styles.actions}>
              {actions.map((a, idx) => {
                const variant = a.variant ?? (idx === 0 ? 'primary' : 'outline');
                return (
                  <ThemedButton
                    key={`${a.label}-${idx}`}
                    title={a.label}
                    variant={variant}
                    onPress={() => {
                      hide();
                      a.onPress?.();
                    }}
                    style={{ width: '100%', minHeight: 52 }}
                    textStyle={{ fontSize: 15 }}
                  />
                );
              })}
            </View>
          </GlassView>
        </View>
      </Modal>
    </AppDialogContext.Provider>
  );
}

export function useAppDialog() {
  const ctx = useContext(AppDialogContext);
  if (!ctx) throw new Error('useAppDialog must be used within AppDialogProvider');
  return ctx;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  card: {
    width: '100%',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
  },
  title: {
    color: 'white',
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  message: {
    marginTop: 10,
    color: Colors.dark.textSecondary,
    fontWeight: '700',
    lineHeight: 20,
  },
  actions: {
    marginTop: 16,
    gap: 10,
  },
});

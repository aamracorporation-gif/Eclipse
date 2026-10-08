import { TouchableOpacity, Text, StyleSheet, StyleProp, ViewStyle, TextStyle, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import React from 'react';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { shadow, theme } from '@/theme/styles';

interface ThemedButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'outline';
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

export function ThemedButton({ 
  title, 
  onPress, 
  loading = false, 
  disabled = false, 
  variant = 'primary',
  style,
  textStyle,
  icon,
  iconPosition = 'left',
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ThemedButtonProps) {
  const isDisabled = disabled || loading;
  const accessibilityProps = {
    accessibilityRole: 'button' as const,
    accessibilityLabel: accessibilityLabel ?? title,
    accessibilityHint,
    accessibilityState: { disabled: isDisabled, busy: loading },
    testID,
  };
  
  if (variant === 'outline') {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={isDisabled}
        style={[styles.outlineButton, disabled && styles.disabled, style]}
        activeOpacity={0.7}
        hitSlop={theme.layout.minTapSize >= 44 ? 6 : 0}
        {...accessibilityProps}
      >
        {loading ? (
          <DiscoLoader size={18} />
        ) : (
          <View style={styles.contentRow}>
            {iconPosition === 'left' && icon}
            <Text style={[styles.outlineText, textStyle]}>{title}</Text>
            {iconPosition === 'right' && icon}
          </View>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.8}
      style={[styles.container, disabled && styles.disabled, style]}
      hitSlop={theme.layout.minTapSize >= 44 ? 6 : 0}
      {...accessibilityProps}
    >
      <LinearGradient
        colors={
          disabled 
            ? ['rgba(15, 23, 42, 0.25)', 'rgba(15, 23, 42, 0.18)'] 
            : variant === 'secondary' 
              ? Colors.dark.secondaryGradient
              : Colors.dark.buttonGradient
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
        pointerEvents="none"
      >
        {loading ? (
          <DiscoLoader size={18} />
        ) : (
          <View style={styles.contentRow}>
            {iconPosition === 'left' && icon}
            <Text style={[styles.text, textStyle]}>{title}</Text>
            {iconPosition === 'right' && icon}
          </View>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  contentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, maxWidth: '100%' },
  container: {
    borderRadius: theme.components.button.borderRadius,
    overflow: 'hidden',
    width: '100%',
    minHeight: theme.components.button.height,
    backgroundColor: Colors.dark.primary,
    ...(shadow('sm') as any),
  },
  gradient: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.space[4],
    paddingVertical: 12,
  },
  // Removed contentContainer as it is no longer needed
  text: {
    flexShrink: 1,
    textAlign: 'center',
    color: Colors.dark.text,
    fontSize: theme.typography.size.md,
    fontWeight: theme.typography.weight.bold,
    letterSpacing: 0.2,
  },
  outlineButton: {
    paddingHorizontal: theme.space[4],
    paddingVertical: 12,
    width: '100%',
    minHeight: theme.components.button.height,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.dark.border,
    borderRadius: theme.components.button.borderRadius,
    backgroundColor: 'transparent',
  },
  outlineText: {
    flexShrink: 1,
    textAlign: 'center',
    color: Colors.dark.primary,
    fontSize: theme.typography.size.md,
    fontWeight: theme.typography.weight.semibold,
  },
  disabled: {
    opacity: 0.6,
  },
});

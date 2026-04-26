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
  iconPosition = 'left'
}: ThemedButtonProps) {
  
  if (variant === 'outline') {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled || loading}
        style={[styles.outlineButton, disabled && styles.disabled, style]}
        activeOpacity={0.7}
        hitSlop={theme.layout.minTapSize >= 44 ? 6 : 0}
      >
        {loading ? (
          <DiscoLoader size={18} />
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
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
      disabled={disabled || loading}
      activeOpacity={0.8}
      style={[styles.container, disabled && styles.disabled, style]}
      hitSlop={theme.layout.minTapSize >= 44 ? 6 : 0}
    >
      <LinearGradient
        colors={
          disabled 
            ? ['#4B5563', '#374151'] 
            : variant === 'secondary' 
              ? ['#06B6D4', '#3B82F6'] 
              : ['#7C3AED', '#4C1D95']
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradient}
        pointerEvents="none"
      >
        {loading ? (
          <DiscoLoader size={18} />
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
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
  container: {
    borderRadius: theme.components.button.borderRadius,
    overflow: 'hidden',
    width: '100%',
    minHeight: theme.components.button.height,
    backgroundColor: '#4C1D95',
    ...(shadow('sm') as any),
  },
  gradient: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.space[4],
  },
  // Removed contentContainer as it is no longer needed
  text: {
    color: 'white',
    fontSize: theme.typography.size.md,
    fontWeight: theme.typography.weight.bold,
    letterSpacing: 0.5,
  },
  outlineButton: {
    width: '100%',
    minHeight: theme.components.button.height,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.dark.border,
    borderRadius: theme.components.button.borderRadius,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  outlineText: {
    color: Colors.dark.text,
    fontSize: theme.typography.size.md,
    fontWeight: theme.typography.weight.semibold,
  },
  disabled: {
    opacity: 0.6,
  },
});

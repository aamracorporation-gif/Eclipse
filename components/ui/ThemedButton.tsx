import { TouchableOpacity, Text, StyleSheet, StyleProp, ViewStyle, TextStyle, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import React from 'react';
import { DiscoLoader } from '@/components/ui/DiscoLoader';

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
      onPress={(e) => {
        console.log('ThemedButton pressed:', title);
        if (onPress) onPress();
      }}
      disabled={disabled || loading}
      activeOpacity={0.8}
      style={[styles.container, disabled && styles.disabled, style]}
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
    borderRadius: 16,
    overflow: 'hidden',
    width: '100%',
    height: 50,
    // Removed zIndex and elevation to prevent touch issues
    backgroundColor: '#4C1D95', 
  },
  gradient: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Removed contentContainer as it is no longer needed
  text: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  outlineButton: {
    width: '100%',
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.dark.border,
    borderRadius: 16,
  },
  outlineText: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.6,
  },
});

import { TextInput, View, StyleSheet, TextInputProps, Text, StyleProp, ViewStyle, TextStyle } from 'react-native';
import { Colors } from '@/constants/Colors';
import { LucideIcon } from 'lucide-react-native';
import React, { forwardRef, isValidElement } from 'react';

interface ThemedInputProps extends Omit<TextInputProps, 'style'> {
  icon?: LucideIcon | React.ReactNode;
  rightIcon?: React.ReactNode;
  error?: string;
  label?: string;
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

export const ThemedInput = forwardRef<TextInput, ThemedInputProps>(({ icon: Icon, rightIcon, error, label, style, containerStyle, inputStyle, ...props }, ref) => {
  return (
    <View style={[styles.wrapper, containerStyle]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.container, error ? styles.errorBorder : null, style]}>
        {Icon && (
          <View style={styles.iconContainer}>
            {isValidElement(Icon) ? (
              Icon
            ) : (
              // @ts-ignore: Icon is treated as a component here
              <Icon size={20} color={Colors.dark.textSecondary} />
            )}
          </View>
        )}
        <TextInput
          ref={ref}
          style={[styles.input, !Icon && styles.noIconInput, !!rightIcon && styles.inputWithRightIcon, inputStyle]}
          placeholderTextColor={Colors.dark.textSecondary}
          {...props}
        />
        {rightIcon && (
          <View style={styles.rightIconContainer}>
            {rightIcon}
          </View>
        )}
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
});

ThemedInput.displayName = 'ThemedInput';

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 16,
    width: '100%',
  },
  label: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    minHeight: 56,
  },
  errorBorder: {
    borderColor: Colors.dark.error,
  },
  iconContainer: {
    paddingLeft: 16,
    paddingRight: 12,
    height: 56,
    justifyContent: 'center',
  },
  rightIconContainer: {
    paddingRight: 16,
    paddingLeft: 12,
    height: 56,
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    minHeight: 56,
    paddingRight: 16,
    paddingVertical: 12, 
  },
  noIconInput: {
    paddingLeft: 16,
  },
  inputWithRightIcon: {
    paddingRight: 0,
  },
  errorText: {
    color: Colors.dark.error,
    fontSize: 12,
    marginTop: 4,
    marginLeft: 4,
  }
});

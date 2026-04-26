import { TextInput, View, StyleSheet, TextInputProps, Text, StyleProp, ViewStyle, TextStyle } from 'react-native';
import { Colors } from '@/constants/Colors';
import { LucideIcon } from 'lucide-react-native';
import React, { forwardRef, isValidElement } from 'react';
import { theme } from '@/theme/styles';

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
    marginBottom: theme.space[4],
    width: '100%',
  },
  label: {
    color: 'white',
    fontSize: theme.typography.size.md,
    fontWeight: theme.typography.weight.semibold,
    marginBottom: theme.space[2],
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: theme.radius.md,
    borderWidth: theme.components.input.borderWidth,
    borderColor: Colors.dark.border,
    minHeight: theme.components.input.minHeight,
  },
  errorBorder: {
    borderColor: Colors.dark.error,
  },
  iconContainer: {
    paddingLeft: theme.space[4],
    paddingRight: theme.space[3],
    height: theme.components.input.minHeight,
    justifyContent: 'center',
  },
  rightIconContainer: {
    paddingRight: theme.space[4],
    paddingLeft: theme.space[3],
    height: theme.components.input.minHeight,
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: theme.typography.size.md,
    minHeight: theme.components.input.minHeight,
    paddingRight: theme.space[4],
    paddingVertical: theme.space[3],
  },
  noIconInput: {
    paddingLeft: theme.space[4],
  },
  inputWithRightIcon: {
    paddingRight: 0,
  },
  errorText: {
    color: Colors.dark.error,
    fontSize: theme.typography.size.xs,
    marginTop: theme.space[1],
    marginLeft: theme.space[1],
  }
});

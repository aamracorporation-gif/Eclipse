import { TextInput, View, StyleSheet, TextInputProps, Text, StyleProp, ViewStyle, TextStyle } from 'react-native';
import { Colors } from '@/constants/Colors';
import { AlertCircle, CheckCircle2, AppIconComponent } from '@/lib/icons';
import React, { forwardRef, isValidElement } from 'react';
import { theme } from '@/theme/styles';

interface ThemedInputProps extends Omit<TextInputProps, 'style'> {
  icon?: AppIconComponent | React.ReactNode;
  leftIcon?: AppIconComponent | React.ReactNode;
  rightIcon?: React.ReactNode;
  error?: string;
  success?: boolean;
  label?: string;
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
}

export const ThemedInput = forwardRef<TextInput, ThemedInputProps>(({ icon, leftIcon, rightIcon, error, success, label, style, containerStyle, inputStyle, ...props }, ref) => {
  const Icon = icon ?? leftIcon;
  const resolvedRightIcon =
    rightIcon ??
    (error
      ? <AlertCircle size={20} color={Colors.dark.error} />
      : (success ? <CheckCircle2 size={20} color={Colors.dark.success} /> : null));
  return (
    <View style={[styles.wrapper, containerStyle]}>
      {label && <Text style={styles.label}>{label}</Text>}
      <View style={[styles.container, error ? styles.errorBorder : null, !error && success ? styles.successBorder : null, style]}>
        {Icon && (
          <View style={styles.iconContainer}>
            {isValidElement(Icon) ? (
              Icon
            ) : (
              (() => {
                const IconComponent = Icon as AppIconComponent;
                return <IconComponent size={20} color={Colors.dark.textSecondary} />;
              })()
            )}
          </View>
        )}
        <TextInput
          ref={ref}
          style={[styles.input, !Icon && styles.noIconInput, !!resolvedRightIcon && styles.inputWithRightIcon, inputStyle]}
          placeholderTextColor={Colors.dark.textSecondary}
          {...props}
        />
        {resolvedRightIcon && (
          <View style={styles.rightIconContainer}>
            {resolvedRightIcon}
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
    color: Colors.dark.text,
    fontSize: theme.typography.size.md,
    fontWeight: theme.typography.weight.semibold,
    marginBottom: theme.space[3],
    letterSpacing: 0.2,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.dark.surfaceSubtle,
    borderRadius: theme.components.input.borderRadius,
    borderWidth: theme.components.input.borderWidth,
    borderColor: Colors.dark.border,
    minHeight: theme.components.input.minHeight,
    shadowColor: Colors.dark.primary,
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  errorBorder: {
    borderColor: Colors.dark.error,
  },
  successBorder: {
    borderColor: Colors.dark.success,
  },
  iconContainer: {
    paddingLeft: theme.space[5],
    paddingRight: theme.space[3],
    height: theme.components.input.minHeight,
    justifyContent: 'center',
  },
  rightIconContainer: {
    paddingRight: theme.space[5],
    paddingLeft: theme.space[3],
    height: theme.components.input.minHeight,
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    color: Colors.dark.text,
    fontSize: 15,
    minHeight: theme.components.input.minHeight,
    paddingRight: theme.space[5],
    paddingVertical: theme.space[4],
    fontWeight: '400',
  },
  noIconInput: {
    paddingLeft: theme.space[5],
  },
  inputWithRightIcon: {
    paddingRight: 0,
  },
  errorText: {
    color: Colors.dark.error,
    fontSize: theme.typography.size.sm,
    marginTop: theme.space[2],
    marginLeft: theme.space[1],
    fontWeight: '400',
  }
});

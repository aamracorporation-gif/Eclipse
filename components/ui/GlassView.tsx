import { View, StyleSheet, ViewProps, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Colors } from '@/constants/Colors';
import { theme } from '@/theme/styles';

interface GlassViewProps extends ViewProps {
  intensity?: number;
  contentContainerStyle?: ViewProps['style'];
}

export function GlassView({ style, contentContainerStyle, intensity = 30, children, ...props }: GlassViewProps) {
  // On Android, we avoid BlurView completely to prevent touch issues
  if (Platform.OS === 'android') {
    const flattened = StyleSheet.flatten(style) as any;
    const backgroundColor = flattened?.backgroundColor ?? Colors.dark.surface;
    const borderColor = flattened?.borderColor ?? Colors.dark.border;
    return (
      <View 
        style={[
          styles.container, 
          style, 
          { backgroundColor, borderColor }
        ]} 
        {...props}
      >
        <View style={[styles.content, contentContainerStyle]}>
          {children}
        </View>
      </View>
    );
  }

  return (
    <BlurView 
      intensity={intensity} 
      tint="dark" 
      style={[styles.container, style]} 
      {...props}
    >
      <View style={[styles.content, contentContainerStyle]}>
        {children}
      </View>
    </BlurView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.dark.surface,
    borderRadius: theme.radius.lg,
    overflow: 'hidden',
    borderWidth: theme.components.card.borderWidth,
    borderColor: Colors.dark.border,
  },
  content: {
    padding: theme.components.card.padding,
    // Ensure content is clickable
    zIndex: 1, 
  }
});

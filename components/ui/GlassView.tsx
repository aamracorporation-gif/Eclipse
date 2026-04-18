import { View, StyleSheet, ViewProps, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Colors } from '@/constants/Colors';

interface GlassViewProps extends ViewProps {
  intensity?: number;
  contentContainerStyle?: ViewProps['style'];
}

export function GlassView({ style, contentContainerStyle, intensity = 30, children, ...props }: GlassViewProps) {
  // On Android, we avoid BlurView completely to prevent touch issues
  if (Platform.OS === 'android') {
    return (
      <View 
        style={[
          styles.container, 
          style, 
          { backgroundColor: 'rgba(20, 20, 30, 0.95)', borderColor: 'rgba(255,255,255,0.1)' }
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
    backgroundColor: Platform.OS === 'android' ? 'rgba(30, 30, 40, 0.85)' : Colors.dark.surface,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  content: {
    padding: 16,
    // Ensure content is clickable
    zIndex: 1, 
  }
});

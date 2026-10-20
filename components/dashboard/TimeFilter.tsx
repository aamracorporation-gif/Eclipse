import { Text, StyleSheet, TouchableOpacity } from 'react-native';
import { GlassView } from '@/components/ui/GlassView';


export type TimeRange = 'day' | 'week' | 'month';

interface TimeFilterProps {
  value: TimeRange;
  onChange: (value: TimeRange) => void;
}

export function TimeFilter({ value, onChange }: TimeFilterProps) {

  const options: { label: string; value: TimeRange }[] = [
    { label: '30 días', value: 'month' },
    { label: '7 días', value: 'week' },
    { label: 'Hoy', value: 'day' },
  ];

  return (
    <GlassView intensity={20} contentContainerStyle={styles.container} style={{marginVertical:12}}>
      {options.map((option) => {
        const isActive = value === option.value;
        return (
          <TouchableOpacity
            accessibilityRole="tab" accessibilityState={{selected:isActive}} key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.tab, isActive && styles.activeTab]}
          >
            <Text style={[styles.text, isActive && styles.activeText]}>
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </GlassView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginVertical: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  activeTab: {
    backgroundColor: '#D9FA65',
  },
  text: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: '500',
  },
  activeText: {
    color: '#0C1718',
    fontWeight: '600',
  },
});

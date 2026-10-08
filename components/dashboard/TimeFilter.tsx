import { Text, StyleSheet, TouchableOpacity } from 'react-native';
import { GlassView } from '@/components/ui/GlassView';
import { useTranslation } from 'react-i18next';

export type TimeRange = 'day' | 'week' | 'month';

interface TimeFilterProps {
  value: TimeRange;
  onChange: (value: TimeRange) => void;
}

export function TimeFilter({ value, onChange }: TimeFilterProps) {
  const { t } = useTranslation();
  const options: { label: string; value: TimeRange }[] = [
    { label: t('creator.stats.filters.month'), value: 'month' },
    { label: t('creator.stats.filters.week'), value: 'week' },
    { label: t('creator.stats.filters.today'), value: 'day' },
  ];

  return (
    <GlassView intensity={20} style={styles.container} contentContainerStyle={styles.options}>
      {options.map((option) => {
        const isActive = value === option.value;
        return (
          <TouchableOpacity
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
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
  options: { flexDirection: 'row', padding: 0, gap: 4 },
  container: {
    padding: 4,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginVertical: 16,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  activeTab: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  text: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: '500',
  },
  activeText: {
    color: '#fff',
    fontWeight: '600',
  },
});

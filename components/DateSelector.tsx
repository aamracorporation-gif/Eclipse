import { View, Text, StyleSheet, TouchableOpacity, FlatList } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useMemo, useRef, useEffect } from 'react';
import { useI18n } from '@/lib/I18nContext';

interface DateSelectorProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
}

export default function DateSelector({ selectedDate, onSelectDate }: DateSelectorProps) {
  const flatListRef = useRef<FlatList>(null);
  const { language } = useI18n();
  const localeTag = language === 'en' ? 'en-US' : language === 'fr' ? 'fr-FR' : 'es-ES';

  const dates = useMemo(() => {
    const d = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Generate next 60 days
    for (let i = 0; i < 60; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      d.push(date);
    }
    return d;
  }, []);

  // Scroll to selected date on mount or change
  useEffect(() => {
    const index = dates.findIndex(d => 
      d.getDate() === selectedDate.getDate() && 
      d.getMonth() === selectedDate.getMonth()
    );
    if (index > 0 && flatListRef.current) {
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
      }, 100);
    }
  }, [selectedDate, dates]);

  const formatDay = (date: Date) => {
    return date.toLocaleDateString(localeTag, { weekday: 'short' }).replace('.', '').toUpperCase();
  };

  const formatDate = (date: Date) => {
    return date.getDate();
  };

  const isSelected = (date: Date) => {
    return (
      date.getDate() === selectedDate.getDate() &&
      date.getMonth() === selectedDate.getMonth() &&
      date.getFullYear() === selectedDate.getFullYear()
    );
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const renderItem = ({ item: date }: { item: Date }) => {
    const selected = isSelected(date);
    const today = isToday(date);
    
    return (
      <TouchableOpacity
        onPress={() => onSelectDate(date)}
        activeOpacity={0.7}
        style={[styles.dateWrapper, selected && styles.dateWrapperSelected]}
      >
        {selected ? (
          <LinearGradient
            colors={['#6366f1', '#818cf8']} 
            style={styles.dateItem}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}>
            <Text style={styles.dayTextSelected}>{formatDay(date)}</Text>
            <Text style={styles.dateTextSelected}>{formatDate(date)}</Text>
          </LinearGradient>
        ) : (
          <View style={styles.dateItemUnselected}>
            {today && <View style={styles.todayDot} />}
            <Text style={styles.dayText}>{formatDay(date)}</Text>
            <Text style={styles.dateText}>{formatDate(date)}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={dates}
        horizontal
        showsHorizontalScrollIndicator={false}
        renderItem={renderItem}
        keyExtractor={(item) => item.toISOString()}
        contentContainerStyle={styles.listContent}
        snapToAlignment="center"
        decelerationRate="fast"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 70, // Reduced height for minimalism
  },
  listContent: {
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 8,
  },
  dateWrapper: {
    width: 50,
    height: 64,
    borderRadius: 16,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  dateWrapperSelected: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    transform: [{ scale: 1.05 }],
    shadowColor: '#6366f1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
    width: 54, // Slightly wider when selected
    height: 68,
  },
  dateItem: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dateItemUnselected: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dayText: {
    fontSize: 10,
    color: '#71717A',
    fontWeight: '600',
    marginBottom: 2,
    letterSpacing: 0.5,
  },
  dateText: {
    fontSize: 18,
    color: '#D4D4D8',
    fontWeight: '600',
  },
  dayTextSelected: {
    fontSize: 10,
    color: 'white',
    fontWeight: '700',
    marginBottom: 2,
    opacity: 0.9,
    letterSpacing: 0.5,
  },
  dateTextSelected: {
    fontSize: 20,
    color: 'white',
    fontWeight: '800',
  },
  todayDot: {
    position: 'absolute',
    top: 6,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#6366f1',
  },
});

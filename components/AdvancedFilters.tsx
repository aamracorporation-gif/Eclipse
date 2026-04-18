import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, useWindowDimensions } from 'react-native';
import { useState } from 'react';
import { BlurView } from 'expo-blur';
import { X, Filter, Music, Shirt, User, SlidersHorizontal } from 'lucide-react-native';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { LinearGradient } from 'expo-linear-gradient';

export type FilterState = {
  minAge: number | null;
  dressCode: string | null;
  musicType: string | null;
};

interface AdvancedFiltersProps {
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
}

export default function AdvancedFilters({ filters, onFilterChange }: AdvancedFiltersProps) {
  const [modalVisible, setModalVisible] = useState(false);
  const [tempFilters, setTempFilters] = useState<FilterState>(filters);
  const { width } = useWindowDimensions();
  const isSmallPhone = width < 360;

  const activeFiltersCount = [
    filters.minAge,
    filters.dressCode,
    filters.musicType
  ].filter(Boolean).length;

  const handleOpen = () => {
    setTempFilters(filters);
    setModalVisible(true);
  };

  const handleApply = () => {
    onFilterChange(tempFilters);
    setModalVisible(false);
  };

  const handleClear = () => {
    const cleared: FilterState = { minAge: null, dressCode: null, musicType: null };
    setTempFilters(cleared); // Clear temp
    onFilterChange(cleared); // Clear actual
    setModalVisible(false);
  };

  // Quick toggle handlers (apply immediately)
  const quickToggleAge = (age: number) => {
    onFilterChange({
      ...filters,
      minAge: filters.minAge === age ? null : age
    });
  };

  const quickToggleMusic = (music: string) => {
    onFilterChange({
      ...filters,
      musicType: filters.musicType === music ? null : music
    });
  };

  // Modal toggle handlers (update temp state)
  const toggleTempAge = (age: number) => {
    setTempFilters(prev => ({
      ...prev,
      minAge: prev.minAge === age ? null : age
    }));
  };

  const toggleTempMusic = (music: string) => {
    setTempFilters(prev => ({
      ...prev,
      musicType: prev.musicType === music ? null : music
    }));
  };

  const toggleTempDress = (code: string) => {
    setTempFilters(prev => ({
      ...prev,
      dressCode: prev.dressCode === code ? null : code
    }));
  };

  const QuickFilterChip = ({ label, selected, onPress }: { label: string, selected: boolean, onPress: () => void }) => (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.quickChip, selected && styles.quickChipSelected]}
    >
      <Text style={[styles.quickChipText, selected && styles.quickChipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );

  const FilterOption = ({ 
    label, 
    selected, 
    onPress 
  }: { 
    label: string, 
    selected: boolean, 
    onPress: () => void 
  }) => (
      <TouchableOpacity 
      onPress={onPress} 
      style={[
        styles.optionChip, 
        selected && styles.optionChipSelected,
        isSmallPhone && { paddingHorizontal: 12, paddingVertical: 6 }
      ]}>
      <Text style={[styles.optionText, selected && styles.optionTextSelected, isSmallPhone && { fontSize: 13 }]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <>
      <View style={styles.container}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          contentContainerStyle={styles.scrollContent}
        >
          <TouchableOpacity onPress={handleOpen} style={styles.filterButton}>
             <View style={[styles.filterIconContainer, activeFiltersCount > 0 && styles.filterIconContainerActive]}>
                <SlidersHorizontal size={18} color={activeFiltersCount > 0 ? 'white' : '#A1A1AA'} />
                {activeFiltersCount > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{activeFiltersCount}</Text>
                  </View>
                )}
             </View>
          </TouchableOpacity>

          <View style={styles.divider} />

          <QuickFilterChip 
            label="Techno" 
            selected={filters.musicType === 'Techno'} 
            onPress={() => quickToggleMusic('Techno')} 
          />
          <QuickFilterChip 
            label="Reggaeton" 
            selected={filters.musicType === 'Reggaeton'} 
            onPress={() => quickToggleMusic('Reggaeton')} 
          />
          <QuickFilterChip 
            label="+18" 
            selected={filters.minAge === 18} 
            onPress={() => quickToggleAge(18)} 
          />
           <QuickFilterChip 
            label="House" 
            selected={filters.musicType === 'House'} 
            onPress={() => quickToggleMusic('House')} 
          />
          <QuickFilterChip 
            label="Comercial" 
            selected={filters.musicType === 'Comercial'} 
            onPress={() => quickToggleMusic('Comercial')} 
          />
        </ScrollView>
      </View>

      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.modalContent}>
            <LinearGradient
              colors={['#1e1b4b', Colors.dark.background]}
              style={styles.modalGradient}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Filtros</Text>
                <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeButton}>
                  <X size={24} color={Colors.dark.text} />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
                
                {/* Age Section */}
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <User size={18} color={Colors.dark.primary} />
                    <Text style={styles.sectionTitle}>Edad Mínima</Text>
                  </View>
                  <View style={styles.optionsRow}>
                    <FilterOption label="+16" selected={tempFilters.minAge === 16} onPress={() => toggleTempAge(16)} />
                    <FilterOption label="+18" selected={tempFilters.minAge === 18} onPress={() => toggleTempAge(18)} />
                    <FilterOption label="+21" selected={tempFilters.minAge === 21} onPress={() => toggleTempAge(21)} />
                    <FilterOption label="+23" selected={tempFilters.minAge === 23} onPress={() => toggleTempAge(23)} />
                  </View>
                </View>

                {/* Music Section */}
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Music size={18} color={Colors.dark.primary} />
                    <Text style={styles.sectionTitle}>Tipo de Música</Text>
                  </View>
                  <View style={styles.optionsGrid}>
                    {['Reggaeton', 'Techno', 'House', 'Comercial', 'Hip Hop', 'Latino'].map(genre => (
                      <FilterOption 
                        key={genre} 
                        label={genre} 
                        selected={tempFilters.musicType === genre} 
                        onPress={() => toggleTempMusic(genre)} 
                      />
                    ))}
                  </View>
                </View>

                {/* Dress Code Section */}
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Shirt size={18} color={Colors.dark.primary} />
                    <Text style={styles.sectionTitle}>Código de Vestimenta</Text>
                  </View>
                  <View style={styles.optionsRow}>
                    {['Casual', 'Elegante', 'Sport', 'Formal'].map(code => (
                      <FilterOption 
                        key={code} 
                        label={code} 
                        selected={tempFilters.dressCode === code} 
                        onPress={() => toggleTempDress(code)} 
                      />
                    ))}
                  </View>
                </View>

              </ScrollView>

              <View style={styles.footer}>
                <TouchableOpacity onPress={handleClear} style={styles.clearButton}>
                  <Text style={styles.clearButtonText}>Borrar</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleApply} style={styles.applyButton}>
                  <LinearGradient
                    colors={[Colors.dark.primary, Colors.dark.secondary]}
                    style={styles.applyGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                  >
                    <Text style={styles.applyButtonText}>Aplicar Filtros</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </LinearGradient>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 50,
    marginBottom: 8,
  },
  scrollContent: {
    paddingHorizontal: 0,
    alignItems: 'center',
    gap: 8,
  },
  filterButton: {
    marginRight: 4,
  },
  filterIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  filterIconContainerActive: {
    backgroundColor: Colors.dark.primary,
    borderColor: Colors.dark.primary,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#EF4444',
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#000',
  },
  badgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '800',
  },
  divider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginHorizontal: 8,
  },
  quickChip: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    height: 44,
    justifyContent: 'center',
  },
  quickChipSelected: {
    backgroundColor: 'white',
    borderColor: 'white',
  },
  quickChipText: {
    color: '#D4D4D8',
    fontSize: 14,
    fontWeight: '600',
  },
  quickChipTextSelected: {
    color: 'black',
    fontWeight: '700',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    height: '85%',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    overflow: 'hidden',
  },
  modalGradient: {
    flex: 1,
    padding: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
  },
  closeButton: {
    padding: 4,
  },
  scrollView: {
    flex: 1,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
  },
  optionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  optionChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  optionChipSelected: {
    backgroundColor: Colors.dark.primary,
    borderColor: Colors.dark.primary,
  },
  optionText: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
  },
  optionTextSelected: {
    color: 'white',
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  clearButton: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  clearButtonText: {
    color: Colors.dark.textSecondary,
    fontSize: 16,
    fontWeight: '600',
  },
  applyButton: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },
  applyGradient: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  applyButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

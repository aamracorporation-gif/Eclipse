import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, ChevronRight, FileText } from '@/lib/icons';
import { useTranslation } from 'react-i18next';

export default function LegalIndexScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <LinearGradient colors={[Colors.dark.background, '#1a1a2e']} style={StyleSheet.absoluteFill} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.8} style={styles.backBtn}>
          <ChevronLeft size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('legal.index_title')}</Text>
        <View style={{ width: 42 }} />
      </View>

      <View style={[styles.group, { marginBottom: insets.bottom + 24 }]}>
        <TouchableOpacity activeOpacity={0.8} style={styles.row} onPress={() => router.push('/legal/aviso-legal')}>
          <View style={styles.iconWrap}>
            <FileText size={18} color="#fff" />
          </View>
          <Text style={styles.rowText}>{t('legal.items.legal_notice')}</Text>
          <ChevronRight size={18} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity activeOpacity={0.8} style={styles.row} onPress={() => router.push('/legal/privacidad')}>
          <View style={styles.iconWrap}>
            <FileText size={18} color="#fff" />
          </View>
          <Text style={styles.rowText}>{t('legal.items.privacy_policy')}</Text>
          <ChevronRight size={18} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity activeOpacity={0.8} style={styles.row} onPress={() => router.push('/legal/terminos')}>
          <View style={styles.iconWrap}>
            <FileText size={18} color="#fff" />
          </View>
          <Text style={styles.rowText}>{t('legal.items.terms')}</Text>
          <ChevronRight size={18} color="rgba(255,255,255,0.6)" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  group: {
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  row: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(124,58,237,0.55)',
  },
  rowText: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '600' },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)' },
});

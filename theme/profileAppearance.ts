import { Platform, StyleSheet } from 'react-native';
import { Colors } from '@/constants/Colors';

// Shared profile and team surfaces; account-specific actions stay in their screens.
export const profileAppearance = StyleSheet.create({
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 16 },
  card: { borderRadius: 20, borderWidth: 1, borderColor: Colors.dark.border, backgroundColor: Colors.dark.surface },
  headerCard: { padding: 16, borderRadius: 20, borderWidth: 1, borderColor: Colors.dark.border, backgroundColor: Colors.dark.surface, overflow: 'hidden' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatarRingWrap: { width: 64, height: 64, borderRadius: 32, flexShrink: 0, overflow: 'hidden' },
  avatarRing: { width: 64, height: 64, padding: 3, borderRadius: 32 },
  avatarRingInner: { flex: 1, borderRadius: 30, overflow: 'hidden', backgroundColor: Colors.dark.surfaceStrong },
  avatarFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.dark.surfaceStrong },
  avatarFallbackText: { color: Colors.dark.text, fontSize: 24, fontWeight: '700', fontFamily: Platform.OS === 'android' ? 'sans-serif' : 'Arial' },
  headerName: { color: Colors.dark.text, fontSize: 20, fontWeight: '700', fontFamily: Platform.OS === 'android' ? 'sans-serif' : 'Arial' },
  headerEmail: { color: Colors.dark.textSecondary, fontSize: 13, marginTop: 4 },
  headerMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  memberBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: Colors.dark.primarySoft },
  memberBadgeText: { color: Colors.dark.secondary, fontSize: 11, fontWeight: '600' },
  title: { color: Colors.dark.text, fontSize: 18, fontWeight: '700' },
  actionRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, gap: 10 },
});

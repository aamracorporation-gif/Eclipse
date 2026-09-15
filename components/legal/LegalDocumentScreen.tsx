import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft } from '@/lib/icons';
import { theme } from '@/theme/styles';

export function LegalDocumentScreen({ title, text }: { title: string; text: string }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <LinearGradient colors={Colors.dark.backgroundGradient} style={StyleSheet.absoluteFill} />
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.8} style={styles.backBtn}>
          <ChevronLeft size={22} color={Colors.dark.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={{ width: 42 }} />
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.body}>{text}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: theme.space[4],
    paddingBottom: theme.space[3],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.surfaceSubtle,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  headerTitle: { color: Colors.dark.text, fontSize: theme.typography.size.lg, fontWeight: theme.typography.weight.bold },
  content: { paddingHorizontal: theme.space[5], paddingTop: theme.space[4] },
  body: { color: Colors.dark.text, opacity: 0.86, fontSize: 15, lineHeight: 22 },
});

import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { useCredit } from '@/lib/WalletContext';
import { Colors } from '@/constants/Colors';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassView } from '@/components/ui/GlassView';
import { DiscoLoader } from '@/components/ui/DiscoLoader';
import { ArrowUpRight, ArrowDownLeft } from '@/lib/icons';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '@/lib/responsive';

export default function WalletScreen() {
  const { creditBalance, movimientos, refreshCredit, loading } = useCredit();
  const insets = useSafeAreaInsets();
  const { horizontalPadding, maxContentWidth, scaleFont } = useResponsive();

  const isCreditMovimiento = (tipo: string) => {
    return tipo === 'generacion_credito_reventa';
  };

  const renderTransaction = ({ item }: { item: any }) => (
    <View style={[styles.rowWrap, { maxWidth: maxContentWidth }]}>
      <GlassView intensity={12} style={styles.transactionCard}>
        <View style={styles.iconBox}>
          {isCreditMovimiento(String(item.tipo || '')) ? (
            <ArrowDownLeft size={20} color={Colors.dark.success} />
          ) : (
            <ArrowUpRight size={20} color={Colors.dark.error} />
          )}
        </View>
        <View style={styles.transactionInfo}>
          <Text style={styles.transactionTitle} numberOfLines={1}>
            {item.descripcion || item.tipo}
          </Text>
          <Text style={styles.transactionDate} numberOfLines={1}>
            {new Date(item.created_at).toLocaleDateString()}
          </Text>
        </View>
        <Text
          style={[
            styles.transactionAmount,
            { color: isCreditMovimiento(String(item.tipo || '')) ? Colors.dark.success : Colors.dark.text },
          ]}
          numberOfLines={1}
        >
          {isCreditMovimiento(String(item.tipo || '')) ? '+' : '-'}
          {Math.abs(Number(item.importe)).toFixed(2)}€
        </Text>
      </GlassView>
    </View>
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Crédito Eclipse', headerTransparent: true, headerTintColor: 'white' }} />
      <LinearGradient
        colors={[Colors.dark.background, '#1e1b4b']}
        style={StyleSheet.absoluteFill}
      />

      <FlatList
        data={movimientos}
        renderItem={renderTransaction}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: insets.top + 14, paddingHorizontal: horizontalPadding, paddingBottom: 40 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={refreshCredit}
            tintColor="transparent"
            colors={['transparent']}
            progressBackgroundColor="transparent"
            title=""
            titleColor="transparent"
            style={{ opacity: 0 }}
          />
        }
        ListHeaderComponent={
          <View style={[styles.headerWrap, { maxWidth: maxContentWidth }]}>
            <GlassView intensity={16} style={styles.balanceCard}>
              <Text style={[styles.balanceLabel, { fontSize: scaleFont(14) }]}>Crédito Eclipse (solo usable en la app)</Text>
              <Text
                style={[styles.balanceValue, { fontSize: scaleFont(44) }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {creditBalance.toFixed(2)}€
              </Text>
              <Text style={[styles.balanceHint, { fontSize: scaleFont(13) }]}>
                El crédito solo se consigue mediante la reventa de entradas y solo se puede usar para comprar en la app. No se puede recargar ni retirar.
              </Text>
            </GlassView>

            <Text style={[styles.sectionTitle, { fontSize: scaleFont(16) }]}>Historial</Text>
            {loading ? (
              <View style={{ marginTop: 12, alignItems: 'center' }}>
                <DiscoLoader size={44} />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={[styles.emptyWrap, { maxWidth: maxContentWidth }]}>
            <Text style={[styles.emptyText, { fontSize: scaleFont(14) }]}>No hay transacciones recientes.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  rowWrap: {
    width: '100%',
    alignSelf: 'center',
  },
  headerWrap: {
    width: '100%',
    alignSelf: 'center',
  },
  balanceCard: {
    padding: 18,
    borderRadius: 24,
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  balanceLabel: {
    color: Colors.dark.textSecondary,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  balanceValue: {
    fontWeight: 'bold',
    color: 'white',
    fontFamily: 'RussoOne_400Regular',
    marginTop: 8,
  },
  balanceHint: {
    marginTop: 12,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.70)',
    fontWeight: '600',
    lineHeight: 18,
    maxWidth: 520,
  },
  sectionTitle: {
    fontWeight: 'bold',
    color: 'white',
    marginTop: 18,
    marginBottom: 12,
  },
  listContent: {
    paddingBottom: 24,
  },
  transactionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    marginBottom: 12,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(0,0,0,0.16)',
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  transactionInfo: {
    flex: 1,
  },
  transactionTitle: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  transactionDate: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'right',
    minWidth: 92,
  },
  emptyWrap: {
    width: '100%',
    alignSelf: 'center',
    paddingTop: 12,
  },
  emptyText: {
    color: Colors.dark.textSecondary,
    textAlign: 'center',
    marginTop: 6,
  },
});

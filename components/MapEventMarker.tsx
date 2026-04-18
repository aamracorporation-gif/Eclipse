import { View, StyleSheet, Text } from 'react-native';
import { Colors } from '@/constants/Colors';

export type CrowdLevel = 'low' | 'medium' | 'full';

function getCrowdColor(level: CrowdLevel) {
  if (level === 'full') return '#EF4444';
  if (level === 'medium') return '#F59E0B';
  return '#22C55E';
}

type MapEventMarkerProps = {
  crowdLevel: CrowdLevel;
  trending?: boolean;
};

export function MapEventMarker({ crowdLevel, trending = false }: MapEventMarkerProps) {
  const color = getCrowdColor(crowdLevel);

  return (
    <View style={[styles.markerOuter, { borderColor: color, shadowColor: color }]}>
      <View style={[styles.markerInner, { backgroundColor: color }]} />
      {trending ? (
        <View style={styles.trendingBadge}>
          <Text style={styles.trendingText}>🔥</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  markerOuter: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    backgroundColor: 'rgba(15, 15, 26, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.8,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  markerInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  trendingBadge: {
    position: 'absolute',
    right: -10,
    top: -12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  trendingText: {
    color: Colors.dark.text,
    fontSize: 12,
    fontWeight: '800',
  },
});


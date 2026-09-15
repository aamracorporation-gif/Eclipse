import { View, Text } from 'react-native';
import React, { forwardRef, useImperativeHandle } from 'react';
import { Colors } from '@/constants/Colors';
import { theme } from '@/theme/styles';

// Mock types
export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export const Marker = (props: any) => {
  return <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.dark.primary }} />;
};

export const Callout = (props: any) => {
    return <View style={{ padding: theme.space[3], backgroundColor: Colors.dark.surfaceOpaque }}>{props.children}</View>;
};

const MapView = forwardRef((props: any, ref) => {
  useImperativeHandle(ref, () => ({
    animateToRegion: (_region: Region, _duration?: number) => {},
    fitToSuppliedMarkers: () => {},
    fitToCoordinates: () => {},
  }));

  return (
    <View style={[{ backgroundColor: Colors.dark.surfaceOpaque, justifyContent: 'center', alignItems: 'center' }, props.style]}>
      <Text style={{ color: Colors.dark.textSecondary }}>El mapa interactivo está disponible en la app móvil.</Text>
      {props.children}
    </View>
  );
});

MapView.displayName = 'MapView';

export default MapView;

import { View, Text } from 'react-native';
import React, { forwardRef, useImperativeHandle } from 'react';

// Mock types
export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export const Marker = (props: any) => {
  return <View style={{ width: 20, height: 20, backgroundColor: 'red' }} />;
};

export const Callout = (props: any) => {
    return <View style={{ padding: 10, backgroundColor: 'white' }}>{props.children}</View>;
};

const MapView = forwardRef((props: any, ref) => {
  useImperativeHandle(ref, () => ({
    animateToRegion: (_region: Region, _duration?: number) => {},
    fitToSuppliedMarkers: () => {},
    fitToCoordinates: () => {},
  }));

  return (
    <View style={[{ backgroundColor: '#eee', justifyContent: 'center', alignItems: 'center' }, props.style]}>
      <Text>El mapa interactivo está disponible en la app móvil.</Text>
      {props.children}
    </View>
  );
});

MapView.displayName = 'MapView';

export default MapView;

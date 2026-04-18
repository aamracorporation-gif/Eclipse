import { useWindowDimensions } from 'react-native';

export function useResponsive() {
  const { width, height } = useWindowDimensions();

  const isSmallPhone = width < 360;
  const isTablet = width >= 768 && width < 1024;
  const isDesktop = width >= 1024;

  const horizontalPadding = isDesktop ? 32 : isTablet ? 24 : 16;
  const maxContentWidth = isDesktop ? 1200 : isTablet ? 960 : width;

  const scaleFont = (base: number) => {
    if (isSmallPhone) return base * 0.9;
    if (isDesktop) return base * 1.15;
    if (isTablet) return base * 1.05;
    return base;
  };

  return {
    width,
    height,
    isSmallPhone,
    isTablet,
    isDesktop,
    horizontalPadding,
    maxContentWidth,
    scaleFont,
  };
}


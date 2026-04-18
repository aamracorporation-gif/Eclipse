import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { Svg, Path, Defs, LinearGradient, Stop, Circle } from 'react-native-svg';
import { useResponsive } from '@/lib/responsive';
import { GlassView } from '@/components/ui/GlassView';
import { Colors } from '@/constants/Colors';
import { useEffect, useState, useMemo } from 'react';

type ChartDataPoint = {
  value: number;
  label: string;
  date: Date;
};

type TimeRange = 'day' | 'week' | 'month';

interface CreatorChartProps {
  data: { date: string; amount: number }[];
  timeRange: TimeRange;
  color?: string;
  height?: number;
}

export function CreatorChart({ data, timeRange, color = '#8b5cf6', height = 220 }: CreatorChartProps) {
  const { maxContentWidth } = useResponsive();
  const screenWidth = Math.min(Dimensions.get('window').width, maxContentWidth);
  const chartWidth = screenWidth - 48; // Padding
  const chartHeight = height - 60; // Padding for labels
  
  // Process data based on time range
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    const now = new Date();
    let filteredData = [...data];
    let groupBy: 'hour' | 'day' | 'month' = 'day';
    
    // 1. Filter by range
    if (timeRange === 'day') {
      const startOfDay = new Date(now.setHours(0,0,0,0));
      filteredData = data.filter(d => new Date(d.date) >= startOfDay);
      groupBy = 'hour';
    } else if (timeRange === 'week') {
      const startOfWeek = new Date(now.setDate(now.getDate() - 7));
      filteredData = data.filter(d => new Date(d.date) >= startOfWeek);
      groupBy = 'day';
    } else if (timeRange === 'month') {
      const startOfMonth = new Date(now.setMonth(now.getMonth() - 1));
      filteredData = data.filter(d => new Date(d.date) >= startOfMonth);
      groupBy = 'day';
    }

    // 2. Group and Aggregate
    const groups: Record<string, number> = {};
    
    filteredData.forEach(item => {
      const date = new Date(item.date);
      let key = '';
      
      if (groupBy === 'hour') {
        key = date.getHours() + ':00';
      } else if (groupBy === 'day') {
        key = `${date.getDate()}/${date.getMonth() + 1}`;
      } else {
        key = `${date.getMonth() + 1}/${date.getFullYear()}`;
      }
      
      groups[key] = (groups[key] || 0) + item.amount;
    });

    // 3. Convert to array and fill gaps (simplified)
    const result: ChartDataPoint[] = Object.entries(groups).map(([label, value]) => ({
      label,
      value,
      date: new Date() // Placeholder, used for sorting if needed
    }));

    // Sort implicitly by label logic or better keep original dates for sorting
    // For simplicity in this demo, we assume data comes somewhat ordered or we just display as is
    // A better approach is to generate all time slots and fill 0
    
    return result; 
  }, [data, timeRange]);

  if (chartData.length === 0) {
    return (
      <View style={[styles.container, { height }]}>
        <Text style={styles.noDataText}>No hay datos para este periodo</Text>
      </View>
    );
  }

  // Calculate scaling
  const maxValue = Math.max(...chartData.map(d => d.value)) || 100;
  const points = chartData.map((d, i) => {
    const x = (i / (chartData.length - 1 || 1)) * chartWidth;
    const y = chartHeight - (d.value / maxValue) * chartHeight;
    return { x, y, value: d.value, label: d.label };
  });

  // Generate Path
  const pathD = points.length > 1 
    ? `M ${points[0].x} ${points[0].y} ` + points.map(p => `L ${p.x} ${p.y}`).join(' ')
    : `M 0 ${chartHeight} L ${chartWidth} ${chartHeight}`; // Flat line if 1 point

  const fillPathD = `${pathD} L ${points[points.length-1]?.x || chartWidth} ${chartHeight} L ${points[0]?.x || 0} ${chartHeight} Z`;

  return (
    <View style={[styles.container, { height }]}>
      <Svg width={chartWidth} height={height}>
        <Defs>
          <LinearGradient id="gradient" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity="0.5" />
            <Stop offset="1" stopColor={color} stopOpacity="0" />
          </LinearGradient>
        </Defs>

        {/* Grid Lines */}
        <Path 
          d={`M 0 ${chartHeight} L ${chartWidth} ${chartHeight}`} 
          stroke="rgba(255,255,255,0.1)" 
          strokeWidth="1" 
        />
        <Path 
          d={`M 0 0 L ${chartWidth} 0`} 
          stroke="rgba(255,255,255,0.05)" 
          strokeWidth="1" 
          strokeDasharray="5, 5"
        />

        {/* Area Fill */}
        <Path d={fillPathD} fill="url(#gradient)" />

        {/* Line Stroke */}
        <Path d={pathD} stroke={color} strokeWidth="3" fill="none" />

        {/* Data Points */}
        {points.map((p, i) => (
          <Circle 
            key={i} 
            cx={p.x} 
            cy={p.y} 
            r="4" 
            fill="#fff" 
            stroke={color} 
            strokeWidth="2" 
          />
        ))}
      </Svg>

      {/* Labels */}
      <View style={styles.labelsContainer}>
        {points.filter((_, i) => i % Math.ceil(points.length / 5) === 0).map((p, i) => (
          <Text key={i} style={[styles.label, { left: p.x - 15 }]}>{p.label}</Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  noDataText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
  },
  labelsContainer: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    height: 20,
  },
  label: {
    position: 'absolute',
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    width: 40,
    textAlign: 'center',
  }
});

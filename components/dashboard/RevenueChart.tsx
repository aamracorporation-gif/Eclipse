import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Svg, Path, Defs, LinearGradient, Stop, Circle, Line } from 'react-native-svg';
import { salesPeriodStart } from '@/lib/organizerSales';

export type TimeRange = 'day' | 'week' | 'month';

interface RevenueChartProps {
  data: { date: string; amount: number }[];
  timeRange: TimeRange;
  color?: string;
  height?: number;
  now?: Date;
}

export function RevenueChart({ data, timeRange, color = '#8b5cf6', height = 220, now = new Date() }: RevenueChartProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const chartWidth = Math.max(0, containerWidth - 40);
  const chartHeight = height - 40; // Space for labels
  
  // Process data based on time range
  const chartPoints = useMemo(() => {
    if (!data || data.length === 0) return [];

    const startDate = salesPeriodStart(timeRange, now);
    const endDate = now;
    const groupBy = timeRange === 'day' ? 'hour' : 'day';
    // 2. Generate Time Slots (Buckets)
    const buckets: { label: string; date: Date; value: number }[] = [];
    const current = new Date(startDate);
    
    // Add buffer end time to include current bucket
    const end = new Date(endDate);
    if (groupBy === 'hour') end.setHours(end.getHours() + 1);
    else end.setDate(end.getDate() + 1);

    while (current < end) {
      let label = '';
      if (groupBy === 'hour') {
        label = `${current.getHours()}:00`;
        // Move to next hour
        const next = new Date(current);
        next.setHours(current.getHours() + 1);
        buckets.push({ label, date: new Date(current), value: 0 });
        current.setTime(next.getTime());
      } else if (groupBy === 'day') {
        label = `${current.getDate()}/${current.getMonth() + 1}`;
        // Move to next day
        const next = new Date(current);
        next.setDate(current.getDate() + 1);
        buckets.push({ label, date: new Date(current), value: 0 });
        current.setTime(next.getTime());
      } else {
        label = `${current.getMonth() + 1}/${current.getFullYear()}`;
         // Move to next month
        const next = new Date(current);
        next.setMonth(current.getMonth() + 1);
        buckets.push({ label, date: new Date(current), value: 0 });
        current.setTime(next.getTime());
      }
    }

    // 3. Aggregate Data into Buckets
    data.forEach(item => {
      const itemDate = new Date(item.date);
      if (itemDate < startDate || itemDate > now) return;

      // Find bucket
      const bucket = buckets.find(b => {
        if (groupBy === 'hour') {
          return b.date.getDate() === itemDate.getDate() && b.date.getHours() === itemDate.getHours();
        } else if (groupBy === 'day') {
           return b.date.getDate() === itemDate.getDate() && b.date.getMonth() === itemDate.getMonth();
        } else {
           return b.date.getMonth() === itemDate.getMonth() && b.date.getFullYear() === itemDate.getFullYear();
        }
      });

      if (bucket) {
        bucket.value += item.amount;
      }
    });

    return buckets;
  }, [data, timeRange, now]);

  if (chartPoints.length === 0) {
    return (
      <View onLayout={event => setContainerWidth(event.nativeEvent.layout.width)} style={[styles.container, { height }]}>
        <Text style={styles.noDataText}>No hay datos para este periodo</Text>
      </View>
    );
  }

  // Calculate scaling
  const maxValue = Math.max(...chartPoints.map(d => d.value)) || 100;
  const points = chartPoints.map((d, i) => {
    const x = (i / (chartPoints.length - 1 || 1)) * chartWidth;
    const y = chartHeight - (d.value / maxValue) * (chartHeight * 0.8) - 10; // 80% height usage + padding
    return { x, y, value: d.value, label: d.label };
  });

  // Generate Path
  const pathD = points.length > 1 
    ? `M ${points[0].x} ${points[0].y} ` + points.map(p => `L ${p.x} ${p.y}`).join(' ')
    : `M 0 ${chartHeight} L ${chartWidth} ${chartHeight}`; // Flat line if 1 point

  const fillPathD = `${pathD} L ${points[points.length-1]?.x || chartWidth} ${chartHeight} L ${points[0]?.x || 0} ${chartHeight} Z`;

  // Select labels to show (max 5-6)
  const labelInterval = Math.ceil(points.length / 6);
  const visibleLabels = points.filter((_, i) => i % labelInterval === 0);

  return (
    <View onLayout={event => setContainerWidth(event.nativeEvent.layout.width)} style={[styles.container, { height }]}>
      <Svg width={chartWidth} height={chartHeight + 30}>
        <Defs>
          <LinearGradient id="gradient" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity="0.5" />
            <Stop offset="1" stopColor={color} stopOpacity="0" />
          </LinearGradient>
        </Defs>

        {/* Grid Lines */}
        <Line 
          x1="0" 
          y1={chartHeight} 
          x2={chartWidth} 
          y2={chartHeight} 
          stroke="rgba(255,255,255,0.1)" 
          strokeWidth="1" 
        />
        
        {/* Area Fill */}
        <Path d={fillPathD} fill="url(#gradient)" />

        {/* Line Stroke */}
        <Path d={pathD} stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />

        {/* Data Points (only if few points) */}
        {points.length < 15 && points.map((p, i) => (
          <Circle 
            key={i} 
            cx={p.x} 
            cy={p.y} 
            r="3" 
            fill="#fff" 
            stroke={color} 
            strokeWidth="2" 
          />
        ))}

        {/* Labels */}
        {visibleLabels.map((p, i) => (
          <React.Fragment key={i}>
            {/* Tick mark */}
            <Line 
              x1={p.x} 
              y1={chartHeight} 
              x2={p.x} 
              y2={chartHeight + 5} 
              stroke="rgba(255,255,255,0.2)" 
              strokeWidth="1" 
            />
            {/* Text Label */}
             {/* Note: SVG Text is tricky with positioning, using View overlay is easier for styling but here we are inside SVG */}
          </React.Fragment>
        ))}
      </Svg>

      {/* Labels Overlay */}
      <View style={[styles.labelsContainer, { width: chartWidth, height: 30, top: chartHeight + 5 }]}>
         {visibleLabels.map((p, i) => (
            <Text 
              key={i} 
              style={[
                styles.label, 
                { 
                  left: p.x - 20, // Center the 40px width label
                  textAlign: 'center'
                }
              ]}
            >
              {p.label}
            </Text>
         ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
  },
  noDataText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
  },
  labelsContainer: {
    position: 'absolute',
  },
  label: {
    position: 'absolute',
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    width: 40,
  }
});

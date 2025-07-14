import React from 'react';
import { View, Text, StyleSheet, ScrollView, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ChartData {
  chart_type: string;
  data_type: string;
  title: string;
  x_axis_label: string;
  y_axis_label: string;
  data_points: Array<{x: string, y: number}>;
  time_period: string;
  total_value?: number;
  unit: string;
  system_name?: string;
}

interface BarChartProps {
  chartData: ChartData;
  isDarkMode: boolean;
  colors: any;
}

const { width: screenWidth } = Dimensions.get('window');

export const BarChart: React.FC<BarChartProps> = ({ chartData, isDarkMode, colors }) => {
  const { data_points, title, unit, total_value, system_name } = chartData;
  
  // Format numbers for display (convert to k format if >= 1000)
  const formatNumber = (value: number): string => {
    if (value >= 1000) {
      const kValue = value / 1000;
      // Format to max 3 digits total
      if (kValue >= 100) {
        return `${Math.round(kValue)}k`; // e.g., 123k
      } else if (kValue >= 10) {
        return `${kValue.toFixed(1)}k`; // e.g., 12.3k
      } else {
        return `${kValue.toFixed(2)}k`; // e.g., 1.23k
      }
    }
    return value.toString();
  };
  
  // Calculate chart dimensions - use full available width
  const containerPadding = 60; // Total horizontal padding
  const chartWidth = screenWidth - containerPadding; // Use full screen width minus padding
  const chartHeight = 220; // Same height as LineChart for consistency
  const maxValue = Math.max(...data_points.map(point => point.y));
  const minValue = Math.min(...data_points.map(point => point.y));
  const valueRange = maxValue - minValue || 1; // Prevent division by zero
  
  // Generate data type icon
  const getDataTypeIcon = (dataType: string) => {
    switch (dataType) {
      case 'energy_production':
        return 'flash';
      case 'co2_savings':
        return 'leaf';
      case 'earnings':
        return 'cash';
      default:
        return 'analytics';
    }
  };
  
  // Generate data type color
  const getDataTypeColor = (dataType: string) => {
    switch (dataType) {
      case 'energy_production':
        return '#4CAF50'; // Green
      case 'co2_savings':
        return '#2196F3'; // Blue
      case 'earnings':
        return '#FF9800'; // Orange
      default:
        return colors.primary;
    }
  };
  
  const chartColor = getDataTypeColor(chartData.data_type);
  
  // Create bar chart data
  const createBarData = () => {
    if (data_points.length === 0) return [];
    
    // Calculate available width for the chart area (excluding y-axis labels)
    const availableChartWidth = chartWidth - 70; // Account for y-axis labels and padding
    const barSpacing = 4; // Space between bars
    const totalSpacing = barSpacing * (data_points.length - 1);
    const barWidth = Math.max(8, (availableChartWidth - totalSpacing) / data_points.length);
    
    return data_points.map((point, index) => {
      const x = index * (barWidth + barSpacing);
      const normalizedValue = (point.y - minValue) / valueRange;
      const barHeight = Math.max(4, normalizedValue * (chartHeight - 40)); // Minimum height of 4px
      const y = chartHeight - barHeight - 20; // Position from top
      
      return { 
        x, 
        y, 
        width: barWidth, 
        height: barHeight, 
        value: point.y, 
        label: point.x 
      };
    });
  };
  
  const barData = createBarData();
  
  return (
    <View style={[
      styles.container, 
      { 
        backgroundColor: isDarkMode ? colors.card : '#f8f9fa',
        borderColor: isDarkMode ? colors.border : '#e1e5e9'
      }
    ]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={[styles.iconContainer, { backgroundColor: chartColor + '20' }]}>
            <Ionicons 
              name={getDataTypeIcon(chartData.data_type)} 
              size={20} 
              color={chartColor} 
            />
          </View>
          <View style={styles.titleContainer}>
            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
            {system_name && (
              <Text style={[styles.subtitle, { color: colors.text + '80' }]}>
                {system_name}
              </Text>
            )}
          </View>
        </View>
        
        {/* Total Value Display */}
        {total_value !== undefined && (
          <View style={[styles.totalContainer, { backgroundColor: chartColor + '10' }]}>
            <Text style={[styles.totalLabel, { color: colors.text + '80' }]}>
              Total
            </Text>
            <Text style={[styles.totalValue, { color: chartColor }]}>
              {total_value.toLocaleString()} {unit}
            </Text>
          </View>
        )}
      </View>
      
      {/* Chart Area */}
      <View style={styles.chartContainer}>
        <View style={[styles.chart, { width: chartWidth }]}>
                     {/* Y-axis labels */}
           <View style={styles.yAxisContainer}>
             <Text style={[styles.axisLabel, { color: colors.text + '60' }]}>
               {formatNumber(maxValue)}
             </Text>
             <Text style={[styles.axisLabel, { color: colors.text + '60' }]}>
               {formatNumber((maxValue + minValue) / 2)}
             </Text>
             <Text style={[styles.axisLabel, { color: colors.text + '60' }]}>
               {formatNumber(minValue)}
             </Text>
           </View>
          
          {/* Chart background grid */}
          <View style={styles.chartArea}>
            {/* Horizontal grid lines */}
            {[0, 1, 2].map((index) => (
              <View
                key={index}
                style={[
                  styles.gridLine,
                  {
                    top: (index * chartHeight) / 3,
                    backgroundColor: colors.text + '10',
                  },
                ]}
              />
            ))}
            
            {/* Bar chart visualization */}
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              style={styles.barsScrollView}
              contentContainerStyle={styles.barsContainer}
            >
              {barData.map((bar, index) => (
                <View key={index} style={styles.barContainer}>
                  {/* Bar */}
                  <View
                    style={[
                      styles.bar,
                      {
                        left: bar.x,
                        top: bar.y,
                        width: bar.width,
                        height: bar.height,
                        backgroundColor: chartColor,
                      },
                    ]}
                  />
                  
                                     {/* Value label on top of bar */}
                   <Text
                     style={[
                       styles.valueLabel,
                       {
                         left: bar.x + bar.width / 2 - 20,
                         top: bar.y - 20,
                         color: colors.text,
                       },
                     ]}
                   >
                     {formatNumber(bar.value)}
                   </Text>
                </View>
              ))}
            </ScrollView>
          </View>
          
          {/* X-axis labels */}
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false}
            style={styles.xAxisScrollView}
          >
            <View style={styles.xAxisContainer}>
              {barData.map((bar, index) => {
                // For many data points, show only every nth label to prevent crowding
                const shouldShowLabel = data_points.length <= 10 || index % Math.ceil(data_points.length / 8) === 0 || index === data_points.length - 1;
                
                if (!shouldShowLabel) return null;
                
                return (
                  <Text
                    key={index}
                    style={[
                      styles.xAxisLabel,
                      {
                        left: bar.x + bar.width / 2 - 25,
                        color: colors.text + '80',
                      },
                    ]}
                  >
                    {bar.label}
                  </Text>
                );
              })}
            </View>
          </ScrollView>
        </View>
      </View>
      
      {/* Chart Info */}
      <View style={styles.chartInfo}>
        <Text style={[styles.chartInfoText, { color: colors.text + '60' }]}>
          {data_points.length} data points • {chartData.time_period} view
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
    marginHorizontal: 0,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    elevation: 2,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  titleContainer: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 14,
  },
  totalContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  totalLabel: {
    fontSize: 14,
  },
  totalValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  chartContainer: {
    height: 300,
  },
  chart: {
    height: 260,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  yAxisContainer: {
    position: 'absolute',
    left: 0,
    top: 8,
    height: 220,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingRight: 8,
    width: 50,
  },
  axisLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  chartArea: {
    marginLeft: 50,
    height: 220,
    position: 'relative',
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
  },
  barsScrollView: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '100%',
  },
  barsContainer: {
    paddingHorizontal: 8,
  },
  barContainer: {
    position: 'relative',
  },
  bar: {
    position: 'absolute',
    borderRadius: 2,
    elevation: 1,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  valueLabel: {
    position: 'absolute',
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
    width: 40,
  },
  xAxisScrollView: {
    marginLeft: 50,
  },
  xAxisContainer: {
    position: 'relative',
    height: 30,
    marginTop: 8,
  },
  xAxisLabel: {
    position: 'absolute',
    fontSize: 10,
    textAlign: 'center',
    width: 50,
  },
  chartInfo: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
  },
  chartInfoText: {
    fontSize: 12,
  },
}); 
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

interface LineChartProps {
  chartData: ChartData;
  isDarkMode: boolean;
  colors: any;
}

const { width: screenWidth } = Dimensions.get('window');

export const LineChart: React.FC<LineChartProps> = ({ chartData, isDarkMode, colors }) => {
  // Get icon and color based on data type
  const getDataTypeConfig = () => {
    switch (chartData.data_type) {
      case 'energy_production':
        return { icon: '⚡', color: '#4CAF50' }; // Green
      case 'co2_savings':
        return { icon: '🌱', color: '#2196F3' }; // Blue
      case 'earnings':
        return { icon: '💰', color: '#FF9800' }; // Orange
      default:
        return { icon: '📊', color: colors.primary };
    }
  };
  
  const { data_points, title, unit, total_value, system_name } = chartData;
  
  // Calculate chart dimensions - use full available width
  const containerPadding = 60; // Total horizontal padding
  const chartWidth = screenWidth - containerPadding; // Use full screen width minus padding
  const chartHeight = 220; // Slightly increased height for better visibility
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
  
  // Create simple line chart points
  const createChartPoints = () => {
    if (data_points.length === 0) return [];
    
    // Calculate available width for the chart area (excluding y-axis labels)
    const availableChartWidth = chartWidth - 70; // Account for y-axis labels and padding
    
    return data_points.map((point, index) => {
      // Distribute points evenly across the available width
      const x = data_points.length === 1 
        ? availableChartWidth / 2 
        : (index / (data_points.length - 1)) * availableChartWidth;
      const normalizedValue = (point.y - minValue) / valueRange;
      const y = chartHeight - (normalizedValue * (chartHeight - 40)); // Leave space for labels
      
      return { x, y, value: point.y, label: point.x };
    });
  };
  
  const chartPoints = createChartPoints();
  
  // Create SVG path for the line (simplified)
  const createLinePath = () => {
    if (chartPoints.length === 0) return '';
    
    let path = `M ${chartPoints[0].x} ${chartPoints[0].y}`;
    for (let i = 1; i < chartPoints.length; i++) {
      path += ` L ${chartPoints[i].x} ${chartPoints[i].y}`;
    }
    return path;
  };
  
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
              {maxValue.toFixed(1)}
            </Text>
            <Text style={[styles.axisLabel, { color: colors.text + '60' }]}>
              {((maxValue + minValue) / 2).toFixed(1)}
            </Text>
            <Text style={[styles.axisLabel, { color: colors.text + '60' }]}>
              {minValue.toFixed(1)}
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
            
            {/* Data points and line visualization */}
            <View style={styles.dataContainer}>
              {chartPoints.map((point, index) => (
                <View key={index} style={styles.dataPointContainer}>
                  {/* Data point */}
                  <View
                    style={[
                      styles.dataPoint,
                      {
                        left: point.x - 4,
                        top: point.y - 4,
                        backgroundColor: chartColor,
                        shadowColor: chartColor,
                      },
                    ]}
                  />
                  
                  {/* Value label */}
                  <Text
                    style={[
                      styles.valueLabel,
                      {
                        left: point.x - 20,
                        top: point.y - 25,
                        color: colors.text,
                      },
                    ]}
                  >
                    {point.value.toFixed(1)}
                  </Text>
                </View>
              ))}
              
              {/* Connection lines between points */}
              {chartPoints.map((point, index) => {
                if (index === chartPoints.length - 1) return null;
                const nextPoint = chartPoints[index + 1];
                const lineWidth = Math.sqrt(
                  Math.pow(nextPoint.x - point.x, 2) + Math.pow(nextPoint.y - point.y, 2)
                );
                const angle = Math.atan2(nextPoint.y - point.y, nextPoint.x - point.x) * (180 / Math.PI);
                
                return (
                  <View
                    key={`line-${index}`}
                    style={[
                      styles.connectionLine,
                      {
                        left: point.x,
                        top: point.y,
                        width: lineWidth,
                        backgroundColor: chartColor,
                        transform: [{ rotate: `${angle}deg` }],
                      },
                    ]}
                  />
                );
              })}
            </View>
          </View>
          
          {/* X-axis labels */}
          <View style={styles.xAxisContainer}>
            {chartPoints.map((point, index) => {
              // For many data points, show only every nth label to prevent crowding
              const shouldShowLabel = data_points.length <= 7 || index % Math.ceil(data_points.length / 6) === 0 || index === data_points.length - 1;
              
              if (!shouldShowLabel) return null;
              
              return (
                <Text
                  key={index}
                  style={[
                    styles.xAxisLabel,
                    {
                      left: point.x - 25, // Slightly wider for better centering
                      color: colors.text + '80',
                    },
                  ]}
                >
                  {point.label}
                </Text>
              );
            })}
          </View>
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
  dataContainer: {
    position: 'relative',
    height: '100%',
  },
  dataPointContainer: {
    position: 'absolute',
  },
  dataPoint: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    elevation: 2,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
  },
  valueLabel: {
    position: 'absolute',
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
    width: 40,
  },
  connectionLine: {
    position: 'absolute',
    height: 2,
    transformOrigin: '0 50%',
  },
  xAxisContainer: {
    position: 'relative',
    height: 30,
    marginLeft: 50,
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
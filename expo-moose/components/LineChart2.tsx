import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { VictoryChart, VictoryLine, VictoryScatter, VictoryAxis, VictoryTheme } from 'victory-native';

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
  const { data_points, title, unit, total_value, system_name } = chartData;
  
  // Add this line to print all data points
  console.log('LineChart data_points:', data_points);
  
  // Or print them with index to see the order
  console.log('LineChart data_points with index:', data_points.map((point, index) => ({
    index,
    x: point.x,
    y: point.y
  })));
  
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
  const chartWidth = screenWidth - containerPadding + 60; // Use full screen width minus padding
  const chartHeight = 250; // Same height as original for consistency
  
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
  
  // Transform data for Victory
  const victoryData = data_points.map((point, index) => (
    {
    x: point.x,
    y: point.y,
  }
));
  
  // Custom tick format for y-axis
  const getYAxisTickFormat = (tick: number) => {
    return formatNumber(tick);
  };
  
  return (
    <View style={[
      styles.container, 
      { 
        backgroundColor: isDarkMode ? colors.card : '#f8f9fa',
        borderColor: isDarkMode ? colors.border : '#e1e5e9'
      }
    ]}>
      {/* Victory Chart Area */}
      <View style={styles.chartContainer}>
        <VictoryChart
          theme={VictoryTheme.material}
          width={chartWidth}
          height={chartHeight + 40}
          padding={{ left: 70, right: 30, top: 30, bottom: 30 }}
          domainPadding={{ x: 10 }} // Increased spacing between points
        >
          {/* Y-axis */}
          <VictoryAxis
            dependentAxis
            tickFormat={getYAxisTickFormat}
            tickCount={5}
            style={{
              axis: { stroke: "transparent" }, // Hide the axis line
              tickLabels: { 
                fontSize: 12, 
                fill: colors.text + '60',
                fontWeight: '500'
              },
              grid: { stroke: "transparent" } // Remove grid lines
            }}
          />
          
          {/* X-axis - positioned at bottom */}
          <VictoryAxis
            style={{
              axis: { 
                stroke: "transparent"
              },
              tickLabels: { 
                fontSize: 10, 
                fill: colors.text + '80',
                fontWeight: '600',
                textAnchor: 'middle'
              },
              ticks: { stroke: colors.text + '20', size: 5 },
              grid: { stroke: "transparent" }
            }}
            tickCount={5}  // Show only 5 labels for better spacing
          />
          
          {/* Line chart */}
          <VictoryLine
            data={victoryData}
            style={{
              data: { 
                stroke: chartColor,
                strokeWidth: 3,
                strokeOpacity: 0.9
              }
            }}
            animate={{
              duration: 1000,
              onLoad: { duration: 500 }
            }}
          />
          
          {/* Data points (circles) */}
          <VictoryScatter
            data={victoryData}
            size={5}
            style={{
              data: { 
                fill: chartColor,
                fillOpacity: 0.9,
                stroke: chartColor,
                strokeWidth: 0.5,
                strokeOpacity: 0.3
              }
            }}
            animate={{
              duration: 1000,
              onLoad: { duration: 500 }
            }}

          />
        </VictoryChart>
        
       
        
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
    height: 320, // Increased height for custom x-axis
    justifyContent: 'center',
    alignItems: 'center',
  },
  customXAxis: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 70,
    paddingVertical: 10,
    marginTop: -20,
  },
  xAxisLabelContainer: {
    flex: 1,
    alignItems: 'center',
  },
  customXAxisLabel: {
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
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

export default LineChart; 
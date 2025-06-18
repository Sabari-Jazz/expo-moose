import React, { useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  Dimensions,
} from 'react-native';
import Svg, {
  Circle,
  Path,
  G,
  Rect,
  Line,
} from 'react-native-svg';
import { FadeInUp } from "react-native-reanimated";
import AnimatedView from "react-native-reanimated";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";

const { width: screenWidth } = Dimensions.get('window');

interface PowerFlowDiagramProps {
  solarPower?: number;
  gridPower?: number;
  batteryPower?: number;
  loadPower?: number;
}

const PowerFlowDiagram: React.FC<PowerFlowDiagramProps> = ({
  solarPower = 22.4,
  gridPower = 1.21,
  batteryPower = 68.4,
  loadPower = 0,
}) => {
  const { isDarkMode, colors } = useTheme();
  
  // Animation references
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Pulse animation for active connections
    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    );

    pulseAnimation.start();

    return () => {
      pulseAnimation.stop();
    };
  }, [solarPower, gridPower, batteryPower, loadPower]);

  const CircularProgress = ({ 
    percentage, 
    color, 
    size = 80, 
    strokeWidth = 6 
  }: {
    percentage: number;
    color: string;
    size?: number;
    strokeWidth?: number;
  }) => {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const strokeDasharray = circumference;
    const strokeDashoffset = circumference - (percentage / 100) * circumference;

    return (
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={isDarkMode ? "#333" : "#E5E5E5"}
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeDasharray={strokeDasharray}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
    );
  };

  const SolarIcon = ({ size = 32 }: { size?: number }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G fill="#FFA500">
        <Circle cx="12" cy="12" r="3" />
        <Path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="#FFA500" strokeWidth="2" strokeLinecap="round"/>
      </G>
    </Svg>
  );

  const GridIcon = ({ size = 32 }: { size?: number }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G fill="#4A90E2">
        <Rect x="9" y="2" width="6" height="8" rx="1" fill="#4A90E2"/>
        <Rect x="7" y="12" width="10" height="2" rx="1" fill="#4A90E2"/>
        <Line x1="9" y1="16" x2="9" y2="22" stroke="#4A90E2" strokeWidth="2" strokeLinecap="round"/>
        <Line x1="15" y1="16" x2="15" y2="22" stroke="#4A90E2" strokeWidth="2" strokeLinecap="round"/>
      </G>
    </Svg>
  );

  const BatteryIcon = ({ size = 32 }: { size?: number }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G fill="#4CAF50">
        <Rect x="2" y="6" width="18" height="12" rx="2" stroke="#4CAF50" strokeWidth="2" fill="transparent"/>
        <Rect x="4" y="8" width="14" height="8" rx="1" fill="#4CAF50" opacity="0.3"/>
        <Rect x="22" y="9" width="2" height="6" rx="1" fill="#4CAF50"/>
      </G>
    </Svg>
  );

  const LoadIcon = ({ size = 32 }: { size?: number }) => (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G fill="#9E9E9E">
        <Rect x="3" y="4" width="18" height="14" rx="2" stroke="#9E9E9E" strokeWidth="2" fill="transparent"/>
        <Rect x="6" y="7" width="12" height="8" rx="1" fill="#9E9E9E" opacity="0.3"/>
        <Line x1="9" y1="10" x2="15" y2="10" stroke="#9E9E9E" strokeWidth="1"/>
        <Line x1="9" y1="12" x2="15" y2="12" stroke="#9E9E9E" strokeWidth="1"/>
      </G>
    </Svg>
  );

  // Calculate percentages for progress circles
  const maxPower = Math.max(Math.abs(solarPower), Math.abs(gridPower), Math.abs(batteryPower), Math.abs(loadPower), 1);
  const solarPercentage = (solarPower / maxPower) * 100;
  const gridPercentage = (Math.abs(gridPower) / maxPower) * 100;
  const batteryPercentage = (Math.abs(batteryPower) / maxPower) * 100;
  const loadPercentage = (loadPower / maxPower) * 100;

  return (
    <AnimatedView.View
      entering={FadeInUp.delay(200).springify()}
      style={[
        styles.section,
        { backgroundColor: isDarkMode ? colors.card : "#fff" },
      ]}
    >
      <ThemedText style={styles.sectionTitle}>Power Flow Diagram</ThemedText>
      
      <View style={styles.diagramContainer}>
        {/* Solar Panel - Top Left */}
        <View style={[styles.powerNode, styles.solarNode]}>
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <View style={styles.progressContainer}>
              <CircularProgress 
                percentage={solarPercentage} 
                color="#FFA500" 
                size={90}
              />
              <View style={styles.iconContainer}>
                <SolarIcon size={28} />
              </View>
            </View>
          </Animated.View>
          <ThemedText style={[styles.powerValue, { color: colors.text }]}>
            {solarPower.toFixed(1)} kW
          </ThemedText>
        </View>

        {/* Grid - Top Right */}
        <View style={[styles.powerNode, styles.gridNode]}>
          <Animated.View style={{ transform: [{ scale: Math.abs(gridPower) > 0 ? pulseAnim : 1 }] }}>
            <View style={styles.progressContainer}>
              <CircularProgress 
                percentage={gridPercentage} 
                color={gridPower >= 0 ? "#4A90E2" : "#FF5722"} 
                size={90}
              />
              <View style={styles.iconContainer}>
                <GridIcon size={28} />
              </View>
            </View>
          </Animated.View>
          <ThemedText style={[styles.powerValue, { color: colors.text }]}>
            {gridPower.toFixed(1)} kW
          </ThemedText>
        </View>

        {/* Central Hub */}
        <View style={styles.centralHub}>
          <View style={[styles.hubCircle, { backgroundColor: isDarkMode ? colors.card : 'white' }]}>
            <Svg width={40} height={40} viewBox="0 0 24 24">
              <Rect x="4" y="3" width="16" height="18" rx="2" stroke={colors.border || "#E0E0E0"} strokeWidth="2" fill={isDarkMode ? colors.card : "white"}/>
              <Rect x="6" y="6" width="12" height="2" fill="#FF5722"/>
              <Rect x="6" y="10" width="8" height="1" fill={colors.text || "#E0E0E0"} opacity="0.5"/>
              <Rect x="6" y="12" width="6" height="1" fill={colors.text || "#E0E0E0"} opacity="0.5"/>
            </Svg>
          </View>
        </View>

        {/* Battery - Bottom Left */}
        <View style={[styles.powerNode, styles.batteryNode]}>
          <Animated.View style={{ transform: [{ scale: Math.abs(batteryPower) > 0 ? pulseAnim : 1 }] }}>
            <View style={styles.progressContainer}>
              <CircularProgress 
                percentage={batteryPercentage} 
                color={batteryPower >= 0 ? "#4CAF50" : "#FF9800"} 
                size={90}
              />
              <View style={styles.iconContainer}>
                <BatteryIcon size={28} />
              </View>
            </View>
          </Animated.View>
          <ThemedText style={[styles.powerValue, { color: colors.text }]}>
            {batteryPower.toFixed(1)} kW
          </ThemedText>
        </View>

        {/* Load - Bottom Right */}
        <View style={[styles.powerNode, styles.loadNode]}>
          <Animated.View style={{ transform: [{ scale: loadPower > 0 ? pulseAnim : 1 }] }}>
            <View style={styles.progressContainer}>
              <CircularProgress 
                percentage={loadPercentage} 
                color="#9E9E9E" 
                size={90}
              />
              <View style={styles.iconContainer}>
                <LoadIcon size={28} />
              </View>
            </View>
          </Animated.View>
          <ThemedText style={[styles.powerValue, { color: colors.text }]}>
            {loadPower.toFixed(1)} kW
          </ThemedText>
        </View>
      </View>
    </AnimatedView.View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 12,
  },
  diagramContainer: {
    width: screenWidth - 64, // Account for margins and padding
    height: 250,
    position: 'relative',
    alignSelf: 'center',
  },
  powerNode: {
    position: 'absolute',
    alignItems: 'center',
  },
  solarNode: {
    top: 0,
    left: 20,
  },
  gridNode: {
    top: 0,
    right: 20,
  },
  batteryNode: {
    bottom: 0,
    left: 20,
  },
  loadNode: {
    bottom: 0,
    right: 20,
  },
  progressContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  powerValue: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 8,
    textAlign: 'center',
  },
  centralHub: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -20 }, { translateY: -20 }],
  },
  hubCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
});

export default PowerFlowDiagram;
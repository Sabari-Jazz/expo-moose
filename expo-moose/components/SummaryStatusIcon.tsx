import React, { useEffect, useState, useRef } from "react";
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { useSession, SystemStatus } from "@/utils/sessionContext";
import { Ionicons } from "@expo/vector-icons";

interface SummaryStatusIconProps {
  showCount?: boolean;
  onPress?: () => void;
}

// Status colors - only 3 states: green->online, red->error, moon->moon
const STATUS_COLORS = {
  online: "#4CAF50", // Green
  error: "#F44336", // Red
  moon: "#9E9E9E", // Grey
};

// Status text mapping - only 3 states
const STATUS_TEXT = {
  online: "Online",
  error: "Error",
  moon: "Sleeping",
};

// Helper function to get display values from SystemStatus
const getDisplayFromSystemStatus = (status: SystemStatus) => {
  switch (status) {
    case "online":
      return { color: STATUS_COLORS.online, text: STATUS_TEXT.online };
    case "error":
      return { color: STATUS_COLORS.error, text: STATUS_TEXT.error };
    case "moon":
      return { color: STATUS_COLORS.moon, text: STATUS_TEXT.moon };
    default:
      return { color: STATUS_COLORS.moon, text: STATUS_TEXT.moon };
  }
};

// Get status icon based on overall status
const getStatusIcon = (status: SystemStatus): any => {
  switch (status) {
    case "moon": return "moon";
    case "error": return "alert-circle-outline";
    case "online": return "checkmark-circle-outline";
    default: return "help-circle-outline";
  }
};

// Use React.memo to prevent unnecessary re-renders
const SummaryStatusIcon = React.memo(({ 
  showCount = false,
  onPress 
}: SummaryStatusIconProps) => {
  const { isDarkMode, colors } = useTheme();
  const { overallStatus, getSystemCount, systemStatuses } = useSession();
  const [isLoading, setIsLoading] = useState(true);
  const [statusColor, setStatusColor] = useState("");
  const [statusText, setStatusText] = useState("");
  const previousStatusRef = useRef<SystemStatus | null>(null);
  
  // Determine if we have enough data to show the summary
  useEffect(() => {
    // Check if we have any system statuses yet
    const statusCount = Object.keys(systemStatuses).length;
    
    if (statusCount > 0) {
      // We have at least one status, we can show the summary
      setIsLoading(false);
      
      // Get status counts and log them
      const statusCounts = getSystemCount();
      console.log(`SummaryStatusIcon: Status counts - Online: ${statusCounts.online}, Error: ${statusCounts.error}, Sleeping: ${statusCounts.moon}`);
      
      // Get display values for overall status
      const { color, text } = getDisplayFromSystemStatus(overallStatus);
      setStatusColor(color);
      setStatusText(text);
    } else {
      // No statuses yet, keep showing loading
      setIsLoading(true);
    }
  }, [systemStatuses, overallStatus, getSystemCount]);
  
  // Track status changes for logging
  useEffect(() => {
    // Only process if we have data and are not in loading state
    if (!isLoading && overallStatus) {
      // If this is the first time we're setting the status or the status has changed
      if (previousStatusRef.current !== overallStatus) {
        console.log(`SummaryStatusIcon: Status changed from ${previousStatusRef.current || 'initial'} to ${overallStatus}`);
        
        // Log detailed status counts
        const statusCounts = getSystemCount();
        console.log(`SummaryStatusIcon: Detailed counts - Online: ${statusCounts.online}, Error: ${statusCounts.error}, Sleeping: ${statusCounts.moon}, Total: ${statusCounts.total}`);
          
        // Update the previous status
        previousStatusRef.current = overallStatus;
      }
    }
  }, [overallStatus, isLoading, getSystemCount]);
  
  // Show loading indicator while data is being collected
  if (isLoading) {
    return (
      <View style={styles.combinedStatusContainer}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      </View>
    );
  }
  
  const renderContent = () => {
    const statusCounts = getSystemCount();
    const statusItems = [];
    
    // Build array of status items to display
    if (statusCounts.online > 0) {
      statusItems.push(
        <Text key="online" style={[styles.statusText, { color: STATUS_COLORS.online }]}>
          {statusCounts.online} Online
        </Text>
      );
    }
    
    if (statusCounts.error > 0) {
      statusItems.push(
        <Text key="error" style={[styles.statusText, { color: STATUS_COLORS.error }]}>
          {statusCounts.error} Error
        </Text>
      );
    }
    
    if (statusCounts.moon > 0) {
      statusItems.push(
        <Text key="moon" style={[styles.statusText, { color: STATUS_COLORS.moon }]}>
          {statusCounts.moon} Sleeping
        </Text>
      );
    }
    
    return (
      <View style={styles.statusContainer}>
        <View style={styles.leftSection}>
          <Ionicons 
            name={getStatusIcon(overallStatus)} 
            size={16} 
            color={STATUS_COLORS[overallStatus]}
            style={styles.statusIcon}
          />
          <Text style={[
            styles.systemStatusText,
            { color: colors.text }
          ]}>
            System Status
          </Text>
        </View>
        
        <View style={styles.rightSection}>
          {statusItems.map((item, index) => (
            <React.Fragment key={item.key}>
              {item}
              {index < statusItems.length - 1 && (
                <Text style={styles.separator}> • </Text>
              )}
            </React.Fragment>
          ))}
        </View>
      </View>
    );
  };
  
  // If onPress is provided, make it touchable
  if (onPress) {
    return (
      <TouchableOpacity 
        style={styles.combinedStatusContainer}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {renderContent()}
      </TouchableOpacity>
    );
  }

  // Return the non-touchable version
  return (
    <View style={styles.combinedStatusContainer}>
      {renderContent()}
    </View>
  );
});

// Export the memoized component
export default SummaryStatusIcon;

const styles = StyleSheet.create({
  combinedStatusContainer: {
    alignItems: "center",
    justifyContent: "center",
    width: "100%", // Full width
    paddingVertical: 8,
  },
  loadingContainer: {
    backgroundColor: "rgba(0,0,0,0.05)",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    minWidth: 100,
    minHeight: 41,
    justifyContent: "center",
    alignItems: "center",
    width: "100%", // Full width for loading state too
  },
  statusContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between", // Changed to space-between for left and right alignment
    backgroundColor: "rgba(0,0,0,0.05)",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    minWidth: 100,
    width: "100%", // Make it full width
  },
  leftSection: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusIcon: {
    marginRight: 8,
  },
  systemStatusText: {
    fontSize: 13, // Smaller font size
    fontWeight: "400", // Changed to 400
  },
  rightSection: {
    flexDirection: "row",
    alignItems: "center",
  },
  statusItem: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 12, // Space between status items
  },
  statusIndicator: {
    width: 10, // Slightly smaller
    height: 10, // Slightly smaller
    borderRadius: 5,
    marginLeft: 6,
  },
  statusText: {
    fontSize: 12, // Smaller font size
    fontWeight: "400", // Changed to 400
  },
  moonIcon: {
    marginLeft: 6,
  },
  separator: {
    color: "#FFFFFF", // White separator
    fontSize: 12,
    fontWeight: "400",
  },
}); 
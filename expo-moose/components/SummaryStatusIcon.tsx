import React, { useEffect, useState, useRef } from "react";
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { useSession, SystemStatus } from "@/utils/sessionContext";
import { Ionicons } from "@expo/vector-icons";

interface SummaryStatusIconProps {
  showCount?: boolean;
  onPress?: () => void;
}

// Status colors - same as StatusIcon for consistency
const STATUS_COLORS = {
  online: "#4CAF50", // Green
  warning: "#FF9800", // Orange
  error: "#F44336", // Red for errors
  offline: "#9E9E9E", // Gray for offline
};

// Use React.memo to prevent unnecessary re-renders
const SummaryStatusIcon = React.memo(({ 
  showCount = false,
  onPress 
}: SummaryStatusIconProps) => {
  const { isDarkMode, colors } = useTheme();
  const { overallStatus, getSystemCount, systemStatuses } = useSession();
  const [isLoading, setIsLoading] = useState(true);
  const previousStatusRef = useRef<SystemStatus | null>(null);
  
  // Determine if we have enough data to show the summary
  useEffect(() => {
    // Check if we have any system statuses yet
    const statusCount = Object.keys(systemStatuses).length;
    
    if (statusCount > 0) {
      // We have at least one status, we can show the summary
      setIsLoading(false);
    } else {
      // No statuses yet, keep showing loading
      setIsLoading(true);
    }
  }, [systemStatuses]);
  
  // Track status changes for logging (removed notification sending)
  useEffect(() => {
    // Only process if we have data and are not in loading state
    if (!isLoading && overallStatus) {
      // If this is the first time we're setting the status or the status has changed
      if (previousStatusRef.current !== overallStatus) {
        console.log(`Status changed from ${previousStatusRef.current || 'initial'} to ${overallStatus}`);
          
        // Update the previous status
        previousStatusRef.current = overallStatus;
      }
    }
  }, [overallStatus, isLoading]);
  
  // Get status label based on overall status
  const getStatusLabel = (status: SystemStatus): string => {
    switch (status) {
      case "offline": return "Systems Offline";
      case "error": return "System Errors";
      case "warning": return "System Warnings";
      case "online": return "All Systems Online";
      default: return "Unknown Status";
    }
  };
  
  // Get status icon based on overall status
  const getStatusIcon = (status: SystemStatus): any => {
    switch (status) {
      case "offline": return "cloud-offline-outline";
      case "error": return "alert-circle-outline";
      case "warning": return "warning-outline";
      case "online": return "checkmark-circle-outline";
      default: return "help-circle-outline";
    }
  };
  
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
            styles.statusText,
            { color: colors.text }
          ]}>
            {getStatusLabel(overallStatus)}
          </Text>
        </View>
        
        {showCount && statusCounts.total > 0 && (
          <View style={styles.countContainer}>
            <Text style={[styles.countText, { color: colors.text }]}>
              {statusCounts.online > 0 && (
                <Text style={{ color: STATUS_COLORS.online }}>{statusCounts.online} Online</Text>
              )}
              {statusCounts.warning > 0 && (
                <Text>
                  {statusCounts.online > 0 ? " • " : ""}
                  <Text style={{ color: STATUS_COLORS.warning }}>{statusCounts.warning} Warning</Text>
                </Text>
              )}
              {statusCounts.error > 0 && (
                <Text>
                  {(statusCounts.online > 0 || statusCounts.warning > 0) ? " • " : ""}
                  <Text style={{ color: STATUS_COLORS.error }}>{statusCounts.error} Error</Text>
                </Text>
              )}
              {statusCounts.offline > 0 && (
                <Text>
                  {(statusCounts.online > 0 || statusCounts.warning > 0 || statusCounts.error > 0) ? " • " : ""}
                  <Text style={{ color: STATUS_COLORS.offline }}>{statusCounts.offline} Offline</Text>
                </Text>
              )}
            </Text>
          </View>
        )}
        
        <View
          style={[
            styles.statusIndicator,
            { backgroundColor: STATUS_COLORS[overallStatus] },
          ]}
        />
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
    justifyContent: "flex-end",
    width: "auto",
    paddingVertical: 4,
  },
  loadingContainer: {
    backgroundColor: "rgba(0,0,0,0.05)",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    minWidth: 180,
    minHeight: 41,
    justifyContent: "center",
    alignItems: "center",
  },
  statusContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(0,0,0,0.05)",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    minWidth: 180,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: 8,
  },
  statusText: {
    fontSize: 14,
    fontWeight: "600",
  },
  statusIcon: {
    marginRight: 6,
  },
  leftSection: {
    flexDirection: "row",
    alignItems: "center",
  },
  countContainer: {
    flex: 1,
    marginHorizontal: 8,
  },
  countText: {
    fontSize: 12,
    textAlign: "right",
  },
}); 
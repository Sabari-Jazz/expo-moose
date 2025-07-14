import React, {useEffect, useState, useCallback, useRef} from "react";
import { StyleSheet, View, Text, ActivityIndicator, TouchableOpacity } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { getSystemStatus } from "@/api/api";
import { useSession, SystemStatus } from "@/utils/sessionContext";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

interface StatusIconProps {
  systemId?: string;
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

// Use React.memo to prevent unnecessary re-renders
const StatusIcon = React.memo(({ 
  systemId = ""
}: StatusIconProps) => {
  const { isDarkMode, colors } = useTheme();
  const { updateSystemStatus, systemStatuses } = useSession();
  const router = useRouter();
  const [statusColor, setStatusColor] = useState("");
  const [statusText, setStatusText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  
  // Refs
  const isMounted = useRef(true);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastFetchTime = useRef<number>(0);
  const statusRef = useRef<SystemStatus | null>(null);
  
  // Initialize status from context if available
  useEffect(() => {
    if (!systemId) {
      setIsLoading(false);
      return;
    }

    const contextStatus = systemStatuses[systemId];
    if (contextStatus) {
      console.log(`StatusIcon: Using context status for system ${systemId}: ${contextStatus}`);
      const { color, text } = getDisplayFromSystemStatus(contextStatus);
      setStatusColor(color);
      setStatusText(text);
      setIsLoading(false);
      statusRef.current = contextStatus;
    } else {
      console.log(`StatusIcon: No context status found for system ${systemId}, will fetch from API`);
      // If no context status, we'll need to fetch from API
      setIsLoading(true);
    }
  }, [systemId, systemStatuses]);

  const fetchStatus = useCallback(async (force = false) => {
    if (!isMounted.current || !systemId) return;
    
    // If we already have a context status and this isn't a forced fetch, skip it
    if (!force && systemStatuses[systemId] && statusRef.current) {
      console.log(`StatusIcon: Skipping API call for system ${systemId}, using context status`);
      return;
    }
    
    // Local throttling - only fetch every 30 seconds unless forced
    const now = Date.now();
    if (!force && (now - lastFetchTime.current < 30000)) {
      console.log("StatusIcon: Throttling API call, last fetch was too recent");
      return;
    }
    
    lastFetchTime.current = now;
    
    try {
      console.log(`StatusIcon: Fetching status from API for system ${systemId}`);
      
      // Get system status from backend API
      const statusData = await getSystemStatus(systemId);
      
      if (!isMounted.current) return;
      
      const status = statusData?.status || "moon";
      console.log(`StatusIcon: Received API status for system ${systemId}: ${status}`);
      
      // Map API status to SystemStatus type - only 3 states
      let contextStatus: SystemStatus;
      if (status === "red" || status === "error") {
        contextStatus = "error";
      } else if (status === "moon") {
        contextStatus = "moon";
      } else if (status === "green" || status === "online") {
        contextStatus = "online";
      } else {
        // Default to moon for unknown statuses
        contextStatus = "moon";
      }
      
      // Get display values
      const { color, text } = getDisplayFromSystemStatus(contextStatus);
      setStatusColor(color);
      setStatusText(text);
      setIsLoading(false);
      
      // Only update system status if it's changed to avoid unnecessary context updates
      if (statusRef.current !== contextStatus) {
        statusRef.current = contextStatus;
        updateSystemStatus(systemId, contextStatus);
      }
      
    } catch (error) {
      if (!isMounted.current) return;
      
      console.error("StatusIcon: Error fetching system status:", error);
      // Default to moon on error
      const { color, text } = getDisplayFromSystemStatus("moon");
      setStatusColor(color);
      setStatusText(text);
      setIsLoading(false);
      
      // Only update status if it's changed
      if (statusRef.current !== "moon" && systemId) {
        statusRef.current = "moon";
        updateSystemStatus(systemId, "moon");
      }
    }
  }, [systemId, updateSystemStatus, systemStatuses]);

  // Setup effect - runs when component mounts or systemId changes
  useEffect(() => {
    // Mark as mounted
    isMounted.current = true;
    
    if (systemId) {
      // Only fetch from API if we don't have context status
      const contextStatus = systemStatuses[systemId];
      if (!contextStatus) {
        console.log(`StatusIcon: No context status for system ${systemId}, fetching from API`);
        fetchStatus(true);
      }
      
      // Set up interval for periodic updates (but less frequent since we have context)
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      
      intervalRef.current = setInterval(() => {
        if (!isMounted.current) return;
        fetchStatus(false);
      }, 5 * 60 * 1000); // 5 minutes - longer interval since we have context status
      console.log(`StatusIcon: Set up polling for system ${systemId} every 5 minutes`);
    } else {
      // No system ID, so we're not going to load anything
      setIsLoading(false);
    }
    
    // Cleanup on unmount
    return () => {
      console.log(`StatusIcon: Cleaning up component for system ${systemId}`);
      // Mark as unmounted
      isMounted.current = false;
      
      // Clear interval
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [systemId, fetchStatus, systemStatuses]); // Re-run if systemId or systemStatuses changes

  // Handle status icon press to navigate to status details
  const handleStatusPress = () => {
    if (systemId) {
      console.log(`StatusIcon: Navigating to status details for system ${systemId}`);
      router.push(`/status-detail/${systemId}` as any);
    }
  };

  // Show loading indicator only if we don't have any status data
  if (isLoading) {
    return (
      <View style={styles.combinedStatusContainer}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      </View>
    );
  }

  // Return the single combined status widget
  return (
    <TouchableOpacity 
      style={styles.combinedStatusContainer}
      onPress={handleStatusPress}
      activeOpacity={0.7}
    >
      <View style={styles.statusContainer}>
        <Text style={[
          styles.statusText,
          { color: colors.text, marginLeft: 6 }
        ]}>
          {statusText}
        </Text>
        {statusText === "Sleeping" ? (
          <Ionicons 
            name="moon" 
            size={16} 
            color={statusColor} 
            style={styles.moonIcon}
          />
        ) : (
          <View
            style={[
              styles.statusIndicator,
              { backgroundColor: statusColor },
            ]}
          />
        )}
      </View>
    </TouchableOpacity>
  );
});

// Export the memoized component
export default StatusIcon;

const styles = StyleSheet.create({
  combinedStatusContainer: {
    alignItems: "center",
    justifyContent: "flex-end",
    width: "auto",
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
  },
  statusContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.05)",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    minWidth: 100,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: 8,
    marginRight: 2,
  },
  statusText: {
    fontSize: 15,
    fontWeight: "600",
  },
  moonIcon: {
    marginLeft: 8,
    marginRight: 2,
  },
}); 
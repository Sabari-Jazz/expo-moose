import React, {useEffect, useState, useCallback, useRef} from "react";
import { StyleSheet, View, Text, ActivityIndicator } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { getSystemStatus } from "@/api/api";
import { useSession, SystemStatus } from "@/utils/sessionContext";

interface StatusIconProps {
  systemId?: string;
}

// Status colors
const STATUS_COLORS = {
  online: "#4CAF50", // Green
  green: "#4CAF50", // Green
  warning: "#FF9800", // Orange
  error: "#F44336", // Red for errors
  red: "#F44336", // Red for errors
  offline: "#9E9E9E", // Gray for offline
};

// Status text mapping
const STATUS_TEXT = {
  online: "Online",
  green: "Online", 
  warning: "Warning",
  error: "Error",
  red: "Error",
  offline: "Offline",
};

// Use React.memo to prevent unnecessary re-renders
const StatusIcon = React.memo(({ 
  systemId = ""
}: StatusIconProps) => {
  const { isDarkMode, colors } = useTheme();
  const { updateSystemStatus } = useSession();
  const [statusColor, setStatusColor] = useState("");
  const [statusText, setStatusText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  
  // Refs
  const isMounted = useRef(true);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastFetchTime = useRef<number>(0);
  const statusRef = useRef<SystemStatus | null>(null);
  
  const fetchStatus = useCallback(async (force = false) => {
    if (!isMounted.current || !systemId) return;
    
    // First fetch should always show loading
    if (force) {
      setIsLoading(true);
    }
    
    // Local throttling - only fetch every 30 seconds unless forced
    const now = Date.now();
    if (!force && (now - lastFetchTime.current < 30000)) {
      console.log("StatusIcon: Throttling API call, last fetch was too recent");
      return;
    }
    
    lastFetchTime.current = now;
    
    try {
      console.log(`StatusIcon: Fetching status for system ${systemId}`);
      
      // Get system status from backend API
      const statusData = await getSystemStatus(systemId);
      
      if (!isMounted.current) return;
      
      const status = statusData?.status || "offline";
      console.log(`StatusIcon: Received status for system ${systemId}: ${status}`);
      
      // Set color and text based on status
      const color = STATUS_COLORS[status as keyof typeof STATUS_COLORS] || STATUS_COLORS.offline;
      const text = STATUS_TEXT[status as keyof typeof STATUS_TEXT] || "Unknown";
      
      setStatusColor(color);
      setStatusText(text);
      setIsLoading(false);
      
      // Map to SystemStatus for context
      let contextStatus: SystemStatus = "online";
      if (status === "red" || status === "error") {
        contextStatus = "error";
      } else if (status === "warning") {
        contextStatus = "warning";
      } else if (status === "offline") {
        contextStatus = "offline";
      } else {
        contextStatus = "online";
      }
      
      // Only update system status if it's changed to avoid unnecessary context updates
      if (statusRef.current !== contextStatus) {
        statusRef.current = contextStatus;
        updateSystemStatus(systemId, contextStatus);
      }
      
    } catch (error) {
      if (!isMounted.current) return;
      
      console.error("StatusIcon: Error fetching system status:", error);
      // Default to offline on error
      setStatusColor(STATUS_COLORS.offline);
      setStatusText("Offline");
      setIsLoading(false);
      
      // Only update status if it's changed
      if (statusRef.current !== "offline" && systemId) {
        statusRef.current = "offline";
        updateSystemStatus(systemId, "offline");
      }
    }
  }, [systemId, updateSystemStatus]);

  // Setup effect - runs when component mounts or systemId changes
  useEffect(() => {
    // Mark as mounted
    isMounted.current = true;
    
    // Initial fetch (forced)
    if (systemId) {
      fetchStatus(true);
      
      // Set up interval - but ensure we don't create duplicate intervals
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      
      intervalRef.current = setInterval(() => {
        if (!isMounted.current) return;
        fetchStatus(false);
      }, 2 * 60 * 1000); // 2 minutes - status updates from backend
      console.log(`StatusIcon: Set up polling for system ${systemId} every 2 minutes`);
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
  }, [systemId, fetchStatus]); // Re-run if systemId changes

  // Show loading indicator while data is being fetched
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
    <View style={styles.combinedStatusContainer}>
      <View style={styles.statusContainer}>
        <Text style={[
          styles.statusText,
          { color: colors.text, marginLeft: 6 }
        ]}>
          {statusText}
        </Text>
        <View
          style={[
            styles.statusIndicator,
            { backgroundColor: statusColor },
          ]}
        />
      </View>
    </View>
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
}); 
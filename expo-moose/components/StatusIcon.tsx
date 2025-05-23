import React, {useEffect, useState, useCallback, useRef} from "react";
import { StyleSheet, View, Text, ActivityIndicator } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { getPvSystemMessages, SystemMessage, getPvSystemFlowData } from "@/api/api";
import { getErrorCodesInfo, getMostSevereColor, ErrorCode } from "@/services/errorCodesService";
import { useSession, SystemStatus } from "@/utils/sessionContext";

interface StatusIconProps {
  systemId?: string;
}

// Status colors
const STATUS_COLORS = {
  online: "#4CAF50", // Green
  warning: "#FF9800", // Orange
  error: "#F44336", // Red for errors
  offline: "#9E9E9E", // Gray for offline
};

// Use React.memo to prevent unnecessary re-renders
const StatusIcon = React.memo(({ 
  systemId = ""
}: StatusIconProps) => {
  const { isDarkMode, colors } = useTheme();
  const { updateSystemStatus, lastStatusUpdates } = useSession();
  const [statusColor, setStatusColor] = useState("");
  const [statusText, setStatusText] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  
  // Refs
  const isMounted = useRef(true);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastFetchTime = useRef<number>(0);
  const statusRef = useRef<SystemStatus | null>(null);
  
  // Function to get and update status color based on error codes
  const updateStatusColor = useCallback(async (codes: number[], isOnline: boolean) => {
    if (!isMounted.current) return;
    
    try {
      let newStatus: SystemStatus = "online";
      
      // If system is offline, that's highest priority
      if (!isOnline) {
        console.log("StatusIcon: System is offline, setting status to offline");
        setStatusColor(STATUS_COLORS.offline);
        setStatusText("Offline");
        newStatus = "offline";
      } else if (!codes.length) {
        // If no error codes, system is online and healthy
        console.log("StatusIcon: No error codes to check, setting status to green");
        setStatusColor(STATUS_COLORS.online);
        setStatusText("Online");
        newStatus = "online";
      } else {
        // Get error codes info from database
        const errorCodesInfo = await getErrorCodesInfo(codes);
        
        if (!isMounted.current) return;
        
        // Get most severe color
        const colorName = getMostSevereColor(errorCodesInfo);
        
        console.log(`StatusIcon: Most severe color for error codes: ${colorName || 'none found, defaulting to green'}`);
        
        // Set default text to Online
        setStatusText("Online");
        
        // Map color name to actual color value
        if (colorName === 'red') {
          setStatusColor(STATUS_COLORS.error);
          setStatusText("Error");
          newStatus = "error";
        } else if (colorName === 'yellow') {
          setStatusColor(STATUS_COLORS.warning);
          setStatusText("Warning");
          newStatus = "warning";
        } else {
          // If no color found or null or green, default to green
          setStatusColor(STATUS_COLORS.online);
          newStatus = "online";
        }
      }
      
      // Only update system status if it's changed to avoid unnecessary context updates
      if (statusRef.current !== newStatus) {
        statusRef.current = newStatus;
        
        // Update global context with this system's status (context has its own throttling)
        if (systemId) {
          updateSystemStatus(systemId, newStatus);
        }
      }
      
      setIsLoading(false);
    } catch (error) {
      if (!isMounted.current) return;
      
      console.error("StatusIcon: Error updating status color:", error);
      // Default to green on error
      setStatusColor(STATUS_COLORS.online);
      setIsLoading(false);
      
      // Only update status if it's changed
      if (statusRef.current !== "online" && systemId) {
        statusRef.current = "online";
        updateSystemStatus(systemId, "online");
      }
    }
  }, [systemId, updateSystemStatus]);
  
  const fetchStatus = useCallback(async (force = false) => {
    if (!isMounted.current || !systemId) return;
    
    // First fetch should always show loading
    if (force) {
      setIsLoading(true);
    }
    
    // Check for context-level throttling - if we updated recently, don't fetch again
    const lastContextUpdate = lastStatusUpdates[systemId];
    const now = Date.now();
    
    // Local throttling
    if (!force && (now - lastFetchTime.current < 30000)) {
      console.log("StatusIcon: Throttling API call, last local fetch was too recent");
      return;
    }
    
    // Context throttling - if the context was updated recently, don't bother fetching
    if (!force && lastContextUpdate && (now - lastContextUpdate < 30000)) {
      console.log("StatusIcon: Throttling API call, status was updated in context recently");
      return;
    }
    
    lastFetchTime.current = now;
    
    try {
      // Get date from yesterday in ISO format
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      const fromDate = yesterday.toISOString().split('.')[0] + 'Z';
      
      // First check if system is online using flow data
      const flowData = await getPvSystemFlowData(systemId);
      const isOnline = flowData?.status?.isOnline ?? false;
      
      if (!isMounted.current) return;
      
      // Fetch error messages from the last day
      const response = await getPvSystemMessages(systemId, {
        statetype: "Error", // lowercase as per API definition
        from: fromDate
      });
      
      if (!isMounted.current) return;
      
      // Check if response has a messages property (new API format)
      const messages = response && typeof response === 'object' && 'messages' in response 
        ? response.messages 
        : response;
      
      if (messages && Array.isArray(messages)) {
        // Extract all state codes
        const codes = messages
          .filter(message => message.stateCode !== undefined)
          .map(message => {
            // Convert to number if it's a string
            const code = typeof message.stateCode === 'string' 
              ? parseInt(message.stateCode, 10) 
              : message.stateCode;
            
            return isNaN(code) ? null : code;
          })
          .filter((code): code is number => code !== null); // Type guard to ensure non-null values
        
        if (!isMounted.current) return;
        
        // Update status color based on online status and error codes
        await updateStatusColor(codes, isOnline);
      } else {
        if (!isMounted.current) return;
        
        // Update status with no error codes but respect online status
        await updateStatusColor([], isOnline);
      }
    } catch (error) {
      if (!isMounted.current) return;
      
      console.error("StatusIcon: Error fetching system messages:", error);
      setStatusColor(STATUS_COLORS.online);
      setIsLoading(false);
    }
  }, [systemId, updateStatusColor, lastStatusUpdates]);

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
      }, 10 * 60 * 1000); // 10 minutes - increased to reduce API calls
      console.log(`StatusIcon: Set up polling for system ${systemId} every 10 minutes`);
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
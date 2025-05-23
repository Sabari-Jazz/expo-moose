import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { AUTH_TOKEN_KEY, AUTH_USER_KEY, authenticate, User } from "./auth";
import { deleteValueFor, getValueFor, save } from "./secureStore";

// System status type - include an "error" state distinct from "offline"
export type SystemStatus = "online" | "warning" | "error" | "offline";

// Define types for the session context
type SessionContextType = {
  session: User | null;
  isLoading: boolean;
  signIn: (username: string, password: string) => Promise<User | null>;
  signOut: () => Promise<void>;
  // System status tracking
  systemStatuses: Record<string, SystemStatus>;
  overallStatus: SystemStatus;
  updateSystemStatus: (systemId: string, status: SystemStatus) => void;
  getSystemCount: () => { total: number, online: number, warning: number, error: number, offline: number };
  // Last update tracking to prevent excessive updates
  lastStatusUpdates: Record<string, number>;
};

// Create a context with default values
const SessionContext = createContext<SessionContextType>({
  session: null,
  isLoading: true,
  signIn: async () => null,
  signOut: async () => {},
  // Default system status values
  systemStatuses: {},
  overallStatus: "online",
  updateSystemStatus: () => {},
  getSystemCount: () => ({ total: 0, online: 0, warning: 0, error: 0, offline: 0 }),
  lastStatusUpdates: {},
});

// Custom hook to use the session context
export function useSession() {
  return useContext(SessionContext);
}

// Helper to determine the most severe status
const getMostSevereStatus = (statuses: SystemStatus[]): SystemStatus => {
  if (statuses.includes("offline")) return "offline";
  if (statuses.includes("error")) return "error";
  if (statuses.includes("warning")) return "warning";
  return "online";
};

// The session provider component
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [systemStatuses, setSystemStatuses] = useState<Record<string, SystemStatus>>({});
  const [overallStatus, setOverallStatus] = useState<SystemStatus>("online");
  const [lastStatusUpdates, setLastStatusUpdates] = useState<Record<string, number>>({});
  
  // Throttling settings
  const UPDATE_THROTTLE_MS = 30000; // 30 seconds between status updates
  
  // Load the session from secure storage on component mount
  useEffect(() => {
    const loadSession = async () => {
      setIsLoading(true);
      try {
        const userJson = await getValueFor(AUTH_USER_KEY);
        if (userJson) {
          const userData = JSON.parse(userJson);
          setSession(userData);
        }
      } catch (error) {
        console.error("Error loading session:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSession();
  }, []);

  // Function to update individual system status with throttling
  const updateSystemStatus = (systemId: string, status: SystemStatus) => {
    const now = Date.now();
    
    // Check if we should throttle this update
    if (lastStatusUpdates[systemId] && now - lastStatusUpdates[systemId] < UPDATE_THROTTLE_MS) {
      // Don't update if it's been updated too recently
      console.log(`Throttling status update for system ${systemId}`);
      return;
    }
    
    // If the status is changing or it's been long enough since the last update
    if (systemStatuses[systemId] !== status || !lastStatusUpdates[systemId]) {
      console.log(`Updating status for system ${systemId} to ${status}`);
      
      // Update the statuses
      setSystemStatuses(prevStatuses => {
        const newStatuses = { ...prevStatuses, [systemId]: status };
        
        // Calculate overall status based on all system statuses
        const allStatuses = Object.values(newStatuses);
        const newOverallStatus = getMostSevereStatus(allStatuses);
        
        // Update overall status if needed
        if (newOverallStatus !== overallStatus) {
          setOverallStatus(newOverallStatus);
        }
        
        return newStatuses;
      });
      
      // Record the update time
      setLastStatusUpdates(prev => ({
        ...prev,
        [systemId]: now
      }));
    }
  };

  // Get counts of systems by status
  const getSystemCount = () => {
    const statuses = Object.values(systemStatuses);
    return {
      total: statuses.length,
      online: statuses.filter(s => s === "online").length,
      warning: statuses.filter(s => s === "warning").length,
      error: statuses.filter(s => s === "error").length,
      offline: statuses.filter(s => s === "offline").length
    };
  };

  // Sign in function
  const signIn = async (username: string, password: string) => {
    try {
      const user = await authenticate(username, password);
      setSession(user);
      return user;
    } catch (error) {
      console.error("Sign in error:", error);
      return null;
    }
  };

  // Sign out function
  const signOut = async () => {
    try {
      // Remove auth token and user data
      await deleteValueFor(AUTH_TOKEN_KEY);
      await deleteValueFor(AUTH_USER_KEY);
      setSession(null);
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  return (
    <SessionContext.Provider value={{ 
      session, 
      isLoading, 
      signIn, 
      signOut,
      systemStatuses,
      overallStatus,
      updateSystemStatus,
      getSystemCount,
      lastStatusUpdates 
    }}>
      {children}
    </SessionContext.Provider>
  );
}

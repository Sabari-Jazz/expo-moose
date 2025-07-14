import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { deleteValueFor, getValueFor, save } from "./secureStore";
import { 
  User, 
  signIn as cognitoSignIn, 
  signOut as cognitoSignOut,
  getCurrentUser,
  AUTH_USER_KEY,
  initAuth
} from "./cognitoAuth";
import { callLambdaApi } from "./api";
import { getUserIncidents, updateIncidentStatus, Incident, getSystemStatus } from '../api/api';

// System status type - only 3 states: green->online, red->error, moon->moon
export type SystemStatus = "online" | "error" | "moon";

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
  getSystemCount: () => { total: number, online: number, error: number, moon: number };
  // Last update tracking to prevent excessive updates
  lastStatusUpdates: Record<string, number>;
  // Incident management
  incidents: Incident[];
  loadIncidents: () => Promise<void>;
  updateIncident: (incidentId: string, action: 'dismiss' | 'escalate') => Promise<boolean>;
  pendingIncidentsCount: number;
  // Session-based incident modal tracking
  hasShownIncidentsThisSession: boolean;
  markIncidentsAsShown: () => void;
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
  getSystemCount: () => ({ total: 0, online: 0, error: 0, moon: 0 }),
  lastStatusUpdates: {},
  incidents: [],
  loadIncidents: async () => {},
  updateIncident: async () => false,
  pendingIncidentsCount: 0,
  hasShownIncidentsThisSession: false,
  markIncidentsAsShown: () => {},
});

// Custom hook to use the session context
export function useSession() {
  return useContext(SessionContext);
}

// Helper to determine the most severe status (error > moon > online)
const getMostSevereStatus = (statuses: SystemStatus[]): SystemStatus => {
  if (statuses.includes("error")) return "error";
  if (statuses.includes("moon")) return "moon";
  return "online";
};

// The session provider component
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [systemStatuses, setSystemStatuses] = useState<Record<string, SystemStatus>>({});
  const [overallStatus, setOverallStatus] = useState<SystemStatus>("online");
  const [lastStatusUpdates, setLastStatusUpdates] = useState<Record<string, number>>({});
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [hasShownIncidentsThisSession, setHasShownIncidentsThisSession] = useState(false);
  
  // Throttling settings
  const UPDATE_THROTTLE_MS = 30000; // 30 seconds between status updates
  
  // Load the session from secure storage on component mount
  useEffect(() => {
    const loadSession = async () => {
      setIsLoading(true);
      try {
        // Initialize auth
        await initAuth();
        
        // Get the current user
        const userData = await getCurrentUser();
        if (userData) {
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

  // Function to load all system statuses in the background
  const loadAllSystemStatuses = useCallback(async (systemIds: string[]) => {
    if (!systemIds || systemIds.length === 0) {
      console.log("No systems to load statuses for");
      return;
    }

    console.log(`Loading background statuses for ${systemIds.length} systems`);
    
    // Load statuses in parallel
    const loadSystemStatus = async (systemId: string) => {
      try {
        console.log(`Fetching background status for system ${systemId}`);
        const statusData = await getSystemStatus(systemId);
        const status = statusData?.status || "moon";
        
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
        
        console.log(`Background status for system ${systemId}: ${status} -> ${contextStatus}`);
        
        // Directly update the system status bypassing throttling for initial load
        setSystemStatuses(prevStatuses => {
          const newStatuses = { ...prevStatuses, [systemId]: contextStatus };
          return newStatuses;
        });
        
        // Record the update time
        setLastStatusUpdates(prev => ({
          ...prev,
          [systemId]: Date.now()
        }));
        
      } catch (error) {
        console.error(`Error loading background status for system ${systemId}:`, error);
        // Default to moon on error
        setSystemStatuses(prevStatuses => ({
          ...prevStatuses,
          [systemId]: "moon"
        }));
        
        // Record the update time
        setLastStatusUpdates(prev => ({
          ...prev,
          [systemId]: Date.now()
        }));
      }
    };

    // Load all statuses in parallel
    await Promise.all(systemIds.map(loadSystemStatus));
    
    console.log(`Completed loading background statuses for ${systemIds.length} systems`);
    
    // After all statuses are loaded, calculate overall status
    setSystemStatuses(prevStatuses => {
      const allStatuses = Object.values(prevStatuses);
      const newOverallStatus = getMostSevereStatus(allStatuses);
      setOverallStatus(newOverallStatus);
      return prevStatuses;
    });
  }, []);

  // Load all system statuses when session loads with systems
  useEffect(() => {
    if (session && 'systems' in session && session.systems && Array.isArray(session.systems) && session.systems.length > 0) {
      console.log(`Session loaded with ${session.systems.length} systems, loading background statuses`);
      loadAllSystemStatuses(session.systems as string[]);
    } else if (session) {
      console.log("Session loaded but no systems found");
      // Clear any existing statuses if user has no systems
      setSystemStatuses({});
      setOverallStatus("online");
      setLastStatusUpdates({});
    }
  }, [session, loadAllSystemStatuses]);

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

  // Get counts of systems by status - only 3 states
  const getSystemCount = () => {
    const statuses = Object.values(systemStatuses);
    return {
      total: statuses.length,
      online: statuses.filter(s => s === "online").length,
      error: statuses.filter(s => s === "error").length,
      moon: statuses.filter(s => s === "moon").length
    };
  };

  // Sign in function - use the Cognito signIn
  const signIn = async (username: string, password: string) => {
    try {
      const user = await cognitoSignIn(username, password);
      setSession(user);
      return user;
    } catch (error) {
      console.error("Sign in error:", error);
      return null;
    }
  };

  // Sign out function - use the Cognito signOut
  const signOut = async () => {
    try {
      await cognitoSignOut();
      setSession(null);
      
      // Also clear status data
      setSystemStatuses({});
      setOverallStatus("online");
      setLastStatusUpdates({});
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  // Load incidents for the current user
  const loadIncidents = useCallback(async () => {
    if (!session?.id) {
      console.log("No session available, cannot load incidents");
      return;
    }

    try {
      console.log(`Loading incidents for user ${session.id}`);
      const incidents = await getUserIncidents(session.id);
      console.log(`Loaded ${incidents?.length || 0} incidents for user ${session.id}`);
      console.log('INCIDENTS TEST', incidents);
      setIncidents(incidents || []);
    } catch (error) {
      console.error("Error loading incidents:", error);
      setIncidents([]);
    }
  }, [session?.id]);

  // Auto-load incidents when session changes
  useEffect(() => {
    if (session?.id) {
      loadIncidents();
    } else {
      setIncidents([]);
    }
  }, [session?.id, loadIncidents]);

  // Update incident status
  const updateIncident = useCallback(async (incidentId: string, action: 'dismiss' | 'escalate'): Promise<boolean> => {
    if (!session) {
      console.log("No session available, cannot update incident");
      return false;
    }

    try {
      console.log(`Updating incident ${incidentId} with action: ${action}`);
      const result = await updateIncidentStatus(session.id, incidentId, action);
      
      if (result.success) {
        // Update local state
        setIncidents(prevIncidents => 
          prevIncidents.map(incident => 
            incident.PK === `Incident#${incidentId}`
              ? { ...incident, status: action === 'dismiss' ? 'dismissed' : 'escalated', updatedAt: new Date().toISOString() }
              : incident
          )
        );
        console.log(`Successfully updated incident ${incidentId}`);
        return true;
      } else {
        console.error(`Failed to update incident ${incidentId}:`, result);
        return false;
      }
    } catch (error) {
      console.error("Error updating incident:", error);
      return false;
    }
  }, [session]);

  // Calculate pending incidents count
  const pendingIncidentsCount = incidents.filter(incident => incident.status === 'pending').length;

  // Mark incidents as shown for this session
  const markIncidentsAsShown = useCallback(() => {
    setHasShownIncidentsThisSession(true);
  }, []);

  // Reset incident modal tracking when session changes
  useEffect(() => {
    if (session?.id) {
      // User logged in - reset the flag so incidents can be shown
      setHasShownIncidentsThisSession(false);
    } else {
      // User logged out - also reset the flag
      setHasShownIncidentsThisSession(false);
    }
  }, [session?.id]);

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
      lastStatusUpdates,
      incidents,
      loadIncidents,
      updateIncident,
      pendingIncidentsCount,
      hasShownIncidentsThisSession,
      markIncidentsAsShown,
    }}>
      {children}
    </SessionContext.Provider>
  );
}

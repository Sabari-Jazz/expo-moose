import React, { useState, useCallback, useEffect } from "react";
import { StyleSheet, View, TouchableOpacity } from "react-native";
import { Text, IconButton } from "react-native-paper";
import PvSystemMap from "@/components/PvSystemMap";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";
import { getCurrentUser, getAccessibleSystems } from "@/utils/cognitoAuth";

export default function MapScreen() {
  const { isDarkMode, colors } = useTheme();
  const [mapKey, setMapKey] = useState(1); // Used to force re-mount the map
  const [currentUser, setCurrentUser] = useState<{
    id: string;
    role: string;
    name?: string;
    username?: string;
  } | null>(null);
  const [accessibleSystemIds, setAccessibleSystemIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true); // Start with loading true
  const [userDataReady, setUserDataReady] = useState(false); // Add flag to track when user data is fully loaded
  
  // Get the Google Maps API key from environment variables
  const apiKey = Constants.expoConfig?.extra?.googleMapsApiKey;

  if (!apiKey) {
    console.warn(
      "No Google Maps API key configured. Map functionality may be limited."
    );
  }

  // Load current user and accessible systems
  useEffect(() => {
    const loadUserAndAccessibleSystems = async () => {
      try {
        console.log("MAP: Starting to load user data...");
        setLoading(true);
        
        const user = await getCurrentUser();
        console.log("MAP: Current user loaded:", JSON.stringify(user));
        
        if (!user) {
          console.error("MAP: No user found! Make sure you're logged in.");
          setLoading(false);
          return;
        }
        
        setCurrentUser(user);

        if (user) {
          const systemIds = await getAccessibleSystems(user.id);
          console.log("MAP: User ID:", user.id);
          console.log("MAP: User role:", user.role);
          console.log("MAP: User username:", user.username);
          console.log("MAP: Accessible system IDs:", JSON.stringify(systemIds));
          setAccessibleSystemIds(systemIds);
          console.log(
            `MAP: User ${user.name} has access to ${
              systemIds.length === 0 ? "all" : systemIds.length
            } systems for map view`
          );
        }
      } catch (error) {
        console.error("MAP: Error loading user and accessible systems for map:", error);
      } finally {
        // Set loading to false only after user data is fully loaded
        setTimeout(() => {
          setLoading(false);
          console.log("MAP: User data loading complete, map can now filter systems");
          setUserDataReady(true);
        }, 500); // Small delay to ensure state updates are processed
      }
    };

    loadUserAndAccessibleSystems();
  }, []);

  // Filter function to check if current user has access to a system
  const hasAccessToSystem = (systemId: string): boolean => {
    // If loading or user is null, don't try to filter yet
    if (loading || !currentUser) {
      console.log(`MAP: Still loading or no current user, showing all systems temporarily`);
      return true; // Show all systems while loading instead of none
    }

    // Admin role has access to all systems
    if (currentUser.role === "admin") {
      console.log(`MAP: User ${currentUser.name} is admin, granting access to system ${systemId}`);
      return true;
    }

    // Special case for ketan who should have access to only 2 systems
    if (currentUser.username === "ketan") {
      // Hardcoded systems for ketan as defined in auth.ts
      const ketanSystems = [
        "bf915090-5f59-4128-a206-46c73f2f779d",
        "f2fafda2-9b07-40e3-875f-db6409040b9c"
      ];
      const hasAccess = ketanSystems.includes(systemId);
      console.log(`MAP: Ketan specifically has ${hasAccess ? '' : 'NO'} access to system ${systemId}`);
      return hasAccess;
    }

    // Regular check for other users
    const hasAccess = accessibleSystemIds.includes(systemId);
    console.log(`MAP: User ${currentUser.name} has ${hasAccess ? '' : 'NO'} access to system ${systemId}`);
    
    return hasAccess;
  };

  // Function to refresh the map by forcing a re-mount
  const refreshMap = useCallback(() => {
    console.log("Refreshing map...");
    setMapKey((prev) => prev + 1); // Change the key to force re-mount
  }, []);

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: isDarkMode ? colors.background : "#fff" },
      ]}
      edges={["top", "left", "right"]}
    >
      <StatusBar style={isDarkMode ? "light" : "dark"} />
      <View style={styles.headerContainer}>
        <Text variant="headlineSmall" style={{ color: colors.text }}>
          Solar Systems Map
        </Text>
        <IconButton
          icon="refresh"
          iconColor={colors.primary}
          size={24}
          onPress={refreshMap}
        />
      </View>
      <View style={styles.mapContainer}>
        {userDataReady && (
          <PvSystemMap 
            key={mapKey} 
            googleMapsApiKey={apiKey} 
            hasAccessToSystem={hasAccessToSystem}
            loading={loading}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.1)",
  },
  mapContainer: {
    flex: 1,
    overflow: "hidden",
  },
});

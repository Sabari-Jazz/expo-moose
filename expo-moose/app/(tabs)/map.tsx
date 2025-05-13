import React, { useState, useCallback } from "react";
import { StyleSheet, View, TouchableOpacity } from "react-native";
import { Text, IconButton } from "react-native-paper";
import PvSystemMap from "@/components/PvSystemMap";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import { StatusBar } from "expo-status-bar";
import Constants from "expo-constants";

export default function MapScreen() {
  const { isDarkMode, colors } = useTheme();
  const [mapKey, setMapKey] = useState(1); // Used to force re-mount the map

  // Get the Google Maps API key from environment variables
  const apiKey = Constants.expoConfig?.extra?.googleMapsApiKey;

  if (!apiKey) {
    console.warn(
      "No Google Maps API key configured. Map functionality may be limited."
    );
  }

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
        <PvSystemMap key={mapKey} googleMapsApiKey={apiKey} />
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

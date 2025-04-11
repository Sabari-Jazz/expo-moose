import React from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import PvSystemMap from "@/components/PvSystemMap";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import { StatusBar } from "expo-status-bar";

export default function MapScreen() {
  const { isDarkMode, colors } = useTheme();
  const ApiKey = process.env.GOOGLE_MAPS_API_KEY;

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
      </View>
      <View style={styles.mapContainer}>
        <PvSystemMap googleMapsApiKey={ApiKey} />
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

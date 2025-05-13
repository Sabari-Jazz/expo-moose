import React from "react";
import { View, StyleSheet } from "react-native";
import { useThemeColor } from "@/hooks/useThemeColor";

// Background component for Android and web platforms
export default function TabBarBackground() {
  const backgroundColor = useThemeColor({}, "cardBackground");

  return <View style={[styles.container, { backgroundColor }]} />;
}

export function useBottomTabOverflow() {
  return 0;
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20, // Match the borderRadius in the tab bar style
  },
});

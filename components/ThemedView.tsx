import { View, type ViewProps, StyleSheet } from "react-native";

import { useThemeColor } from "@/hooks/useThemeColor";

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  type?: "default" | "card" | "elevated";
};

export function ThemedView({
  style,
  lightColor,
  darkColor,
  type = "default",
  ...otherProps
}: ThemedViewProps) {
  const backgroundColor = useThemeColor(
    { light: lightColor, dark: darkColor },
    type === "card" ? "cardBackground" : "background"
  );

  const borderColor = useThemeColor({}, "border");

  return (
    <View
      style={[
        { backgroundColor },
        type === "card" && styles.card,
        type === "elevated" && [styles.card, styles.elevated, { borderColor }],
        style,
      ]}
      {...otherProps}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 16,
    marginVertical: 8,
    overflow: "hidden",
  },
  elevated: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 1,
  },
});

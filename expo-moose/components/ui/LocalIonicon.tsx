import React from "react";
import { StyleProp, TextStyle } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

// Define icon variants
type IconVariant = "" | "-outline" | "-sharp";

interface LocalIoniconProps {
  name: string;
  size?: number;
  color?: string;
  variant?: IconVariant;
  style?: StyleProp<TextStyle>;
}

/**
 * A component that renders Ionicons from the Expo vector icons
 */
export function LocalIonicon({
  name,
  size = 24,
  color = "black",
  variant = "",
  style,
}: LocalIoniconProps) {
  // Get the full icon name with variant
  const getIoniconsName = () => {
    // If the variant is already part of the name, don't add it again
    if (name.endsWith(variant) && variant !== "") {
      return name;
    }

    // Apply the variant
    if (variant === "-outline") {
      return `${name}-outline`;
    } else if (variant === "-sharp") {
      return `${name}-sharp`;
    }
    return name;
  };

  // Use Ionicons from Expo
  try {
    const iconName = getIoniconsName();
    return (
      <Ionicons
        name={iconName as any}
        size={size}
        color={color}
        style={style}
      />
    );
  } catch (error) {
    console.warn(`Icon not found: ${name}${variant}`);
    // Fallback to a default icon
    return (
      <Ionicons
        name="help-circle-outline"
        size={size}
        color={color}
        style={style}
      />
    );
  }
}

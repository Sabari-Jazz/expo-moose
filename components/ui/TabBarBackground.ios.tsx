import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { BlurView } from "expo-blur";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function BlurTabBarBackground() {
  return (
    <View style={styles.container}>
      <BlurView
        // System chrome material automatically adapts to the system's theme
        // and matches the native tab bar appearance on iOS.
        tint="systemChromeMaterial"
        intensity={100}
        style={[StyleSheet.absoluteFill, styles.blur]}
      />
    </View>
  );
}

export function useBottomTabOverflow() {
  const tabHeight = useBottomTabBarHeight();
  const { bottom } = useSafeAreaInsets();
  return tabHeight - bottom;
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
    borderRadius: 24, // Match the borderRadius in the tab bar style
  },
  blur: {
    borderRadius: 24,
  },
});

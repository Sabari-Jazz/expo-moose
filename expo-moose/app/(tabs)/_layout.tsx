import { Tabs } from "expo-router";
import React from "react";
import {
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HapticTab } from "@/components/HapticTab";
import TabBarBackground from "@/components/ui/TabBarBackground";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { LocalIonicon } from "@/components/ui/LocalIonicon";
import { useThemeColor } from "@/hooks/useThemeColor";
import { useSession } from "@/utils/sessionContext";

/**
 * The tab layout for the app's main navigation
 */
export default function TabLayout() {
  const { isDarkMode, colors } = useTheme();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const primaryColor = useThemeColor({}, "tint");
  const backgroundColor = useThemeColor({}, "background");
  const borderColor = useThemeColor({}, "border");
  const { signOut } = useSession();

  const goToSettings = () => {
    router.push("/settings");
  };

  const handleLogout = async () => {
    await signOut();
  };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: Platform.OS === "ios" ? "#8E8E93" : "#757575",
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarBackground: TabBarBackground,
        tabBarHideOnKeyboard: false,
        tabBarStyle: {
          ...Platform.select({
            ios: {
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              elevation: 0,
              borderRadius: 24,
              height: 60 + (insets.bottom > 0 ? insets.bottom : 10),
              paddingBottom: insets.bottom > 0 ? insets.bottom : 10,
              shadowColor: "#000",
              shadowOffset: {
                width: 0,
                height: 2,
              },
              shadowOpacity: 0.05,
              shadowRadius: 8,
              zIndex: 8,
            },
            android: {
              backgroundColor,
              position: "absolute",
              bottom: 0,
              left: 10,
              right: 10,
              elevation: 20,
              borderRadius: 20,
              height: 60 + (insets.bottom > 0 ? insets.bottom : 10),
              paddingBottom: insets.bottom > 0 ? insets.bottom : 10,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
              borderTopWidth: 0,
              zIndex: 999,
            },
            default: {
              backgroundColor,
              position: "absolute",
              bottom: insets.bottom > 0 ? insets.bottom : 10,
              left: 10,
              right: 10,
              borderRadius: 20,
              height: 60,
              borderTopWidth: 0,
              zIndex: 8,
            },
          }),
          backgroundColor: isDarkMode ? colors.card : "#fff",
          borderTopColor: isDarkMode ? colors.border : "#e0e0e0",
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "500",
          marginBottom: Platform.OS === "ios" ? 0 : 6,
        },
        tabBarItemStyle: {
          paddingTop: Platform.OS === "ios" ? 10 : 0,
        },
        headerStyle: {
          backgroundColor: isDarkMode ? colors.card : "#fff",
        },
        headerShadowVisible: false,
        headerTintColor: colors.text,
        headerRight: () => (
          <View style={styles.headerRightContainer}>
            <TouchableOpacity
              onPress={goToSettings}
              style={styles.headerButton}
            >
              <Ionicons name="settings-outline" size={24} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleLogout}
              style={styles.headerButton}
            >
              <Ionicons name="log-out-outline" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>
        ),
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: "Systems",
          tabBarIcon: ({ color, focused }) => (
            <LocalIonicon
              name="business"
              variant={focused ? "" : "-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: "Map",
          tabBarIcon: ({ color, focused }) => (
            <LocalIonicon
              name="map"
              variant={focused ? "" : "-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="feedback"
        options={{
          title: "Feedback",
          tabBarIcon: ({ color, focused }) => (
            <LocalIonicon
              name="chatbox"
              variant={focused ? "" : "-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
          tabBarIcon: ({ color, focused }) => (
            <LocalIonicon
              name="chatbubble"
              variant={focused ? "" : "-outline"}
              size={24}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  headerRightContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 16,
  },
  headerLeftContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 16,
  },
  headerLogo: {
    width: 120,
    height: 30,
  },
  headerButton: {
    marginLeft: 16,
  },
});

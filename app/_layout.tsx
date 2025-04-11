import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack, router, Redirect } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import "react-native-reanimated";
import { useThemeColor } from "@/hooks/useThemeColor";
import { useColorScheme } from "@/hooks/useColorScheme";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
  Text,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { PaperProvider } from "react-native-paper";
import { SessionProvider, useSession } from "@/utils/sessionContext";


SplashScreen.preventAutoHideAsync();

const CustomLightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: "#FF9800", // Orange
    background: "#FFFBF0", // Light cream
    card: "#FFFFFF",
    text: "#212121",
    border: "#E0E0E0",
    notification: "#FF9800",
  },
};

const CustomDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: "#FFC107", // Amber/Yellow
    background: "#2D2D2D", // Dark gray
    card: "#3D3D3D",
    text: "#FFFFFF",
    border: "#424242",
    notification: "#FFC107",
  },
};

function AppLayoutNav() {
  const { session, isLoading } = useSession();
  const colorScheme = useColorScheme();
  const backgroundColor = useThemeColor({}, "background");

  if (isLoading) {
    return (
      <SafeAreaView
        style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
      >
        <Text>Loading...</Text>
      </SafeAreaView>
    );
  }

  return (
    <ThemeProvider
      value={colorScheme === "dark" ? CustomDarkTheme : CustomLightTheme}
    >
      <KeyboardAvoidingView
        style={styles.container}
        // behavior={Platform.OS === "ios" ? "padding" : undefined}
        // keyboardVerticalOffset={Platform.OS === "ios" ? 150 : 0}
      >
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor },
            animation: "fade",
          }}
        >
          {/* Auth screens */}
          {!session ? (
            <Stack.Screen
              name="login"
              options={{
                headerShown: false,
              }}
            />
          ) : (
            <>
              <Stack.Screen
                name="index"
                options={{
                  headerShown: false,
                }}
              />

              {/* Protected routes */}
              <Stack.Screen
                name="(tabs)"
                options={{
                  // headerShown: true,
                  headerLargeTitle: true,
                  headerLargeTitleShadowVisible: false,
                  title: "Moose",
                }}
              />
              <Stack.Screen
                name="pv-detail/[pvSystemId]"
                options={{
                  animation: "slide_from_right",
                }}
              />
              <Stack.Screen
                name="settings"
                options={{
                  title: "Settings",
                  animation: "slide_from_right",
                }}
              />

              {/* Not found screen */}
              <Stack.Screen name="+not-found" />
              <Stack.Screen name="feedback-admin" />
            </>
          )}
        </Stack>
      </KeyboardAvoidingView>
    </ThemeProvider>
  );
}

// Root layout with providers
export default function RootLayout() {
  const [loaded] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
  });

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PaperProvider>
          <SessionProvider>
            <AppLayoutNav />
          </SessionProvider>
        </PaperProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack, router, Redirect } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useRef } from "react";
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
import * as Notifications from "expo-notifications";
import {
  registerForPushNotificationsAsync,
  scheduleAllDailyNotifications,
  getPrimaryPvSystemId,
} from "@/services/NotificationService";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Configure how notifications appear when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

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
  const notificationListener = useRef<any>();
  const responseListener = useRef<any>();

  // Set up notification handlers
  useEffect(() => {
    // Check if notifications were previously enabled and initialize
    const initializeNotifications = async () => {
      try {
        const enabled = await AsyncStorage.getItem("notifications_enabled");
        if (enabled === "true") {
          // Register for notifications and make sure we have proper permissions
          await registerForPushNotificationsAsync();

          // Check if we have a system ID
          const systemId = await getPrimaryPvSystemId();
          if (!systemId) {
            console.log("No primary PV system set for notifications");
          }

          // Schedule or reschedule the daily notifications
          await scheduleAllDailyNotifications();
        }
      } catch (error) {
        console.error("Error initializing notifications:", error);
      }
    };

    initializeNotifications();

    // Set up notification received listener
    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        console.log("Notification received:", notification);
      });

    // Set up notification response listener
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data;
        console.log("Notification response:", data);

        // Handle notification taps here
        // For example, navigate to a specific screen based on notification type
        if (data.type === "morning-notification" && session) {
          router.replace("/");
        } else if (data.type === "evening-notification" && session) {
          // Navigate to the specific PV system if we have an ID
          const pvSystemId = data.pvSystemId;
          if (pvSystemId) {
            router.push(`/pv-detail/${pvSystemId}`);
          } else {
            router.replace("/");
          }
        }
      });

    return () => {
      // Clean up the event listeners
      Notifications.removeNotificationSubscription(
        notificationListener.current
      );
      Notifications.removeNotificationSubscription(responseListener.current);
    };
  }, [session]);

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
              <Stack.Screen
                name="(tabs)"
                options={{
                  headerShown: false,
                  headerLargeTitle: false,
                  headerLargeTitleShadowVisible: false,
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

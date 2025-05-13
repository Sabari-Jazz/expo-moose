import React, { useEffect, useState } from "react";
import { View, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { Switch, Text, Button, Divider, Menu, List } from "react-native-paper";
import {
  registerForPushNotificationsAsync,
  scheduleMorningNotification,
  scheduleEveningNotification,
  cancelAllNotifications,
  sendDemoNotification,
  getAllScheduledNotifications,
  setPrimaryPvSystemId,
  getPrimaryPvSystemId,
} from "../services/NotificationService";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import * as api from "../api/api";

const NOTIFICATIONS_ENABLED_KEY = "notifications_enabled";

const NotificationSettings = () => {
  const [isEnabled, setIsEnabled] = useState(false);
  const [scheduledNotifications, setScheduledNotifications] = useState<any[]>(
    []
  );
  const [loading, setLoading] = useState(false);
  const [pvSystems, setPvSystems] = useState<api.PvSystemMetadata[]>([]);
  const [selectedPvSystem, setSelectedPvSystem] = useState<string | null>(null);
  const [selectedPvSystemName, setSelectedPvSystemName] = useState<string>("");
  const [loadingSystems, setLoadingSystems] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);

  useEffect(() => {
    // Check if notifications are enabled
    checkNotificationsStatus();

    // Get the list of scheduled notifications
    loadScheduledNotifications();

    // Load PV systems
    loadPvSystems();

    // Get the selected PV system
    loadSelectedPvSystem();

    // Set up notification response handler
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data;
        console.log("Notification response received:", data);
        // Handle notification response if needed
      }
    );

    return () => {
      subscription.remove();
    };
  }, []);

  const checkNotificationsStatus = async () => {
    try {
      const value = await AsyncStorage.getItem(NOTIFICATIONS_ENABLED_KEY);
      const enabled = value === "true";
      setIsEnabled(enabled);
      return enabled;
    } catch (error) {
      console.error("Error retrieving notification status:", error);
      return false;
    }
  };

  const loadScheduledNotifications = async () => {
    try {
      const notifications = await getAllScheduledNotifications();
      setScheduledNotifications(notifications);
    } catch (error) {
      console.error("Error loading scheduled notifications:", error);
    }
  };

  const loadPvSystems = async () => {
    try {
      setLoadingSystems(true);
      const systems = await api.getPvSystems();
      setPvSystems(systems);
    } catch (error) {
      console.error("Error loading PV systems:", error);
      Alert.alert("Error", "Failed to load your PV systems.");
    } finally {
      setLoadingSystems(false);
    }
  };

  const loadSelectedPvSystem = async () => {
    try {
      const pvSystemId = await getPrimaryPvSystemId();
      setSelectedPvSystem(pvSystemId);

      // Find the system name if we have an ID
      if (pvSystemId && pvSystems.length > 0) {
        const system = pvSystems.find((s) => s.pvSystemId === pvSystemId);
        if (system) {
          setSelectedPvSystemName(system.name);
        }
      }
    } catch (error) {
      console.error("Error loading selected PV system:", error);
    }
  };

  const handleSelectPvSystem = async (pvSystemId: string, name: string) => {
    try {
      setMenuVisible(false);
      setSelectedPvSystem(pvSystemId);
      setSelectedPvSystemName(name);
      await setPrimaryPvSystemId(pvSystemId);

      // If notifications are enabled, reschedule them with the new PV system
      if (isEnabled) {
        await scheduleEveningNotification();
      }

      Alert.alert(
        "Success",
        `${name} is now your primary system for notifications.`
      );
    } catch (error) {
      console.error("Error selecting PV system:", error);
      Alert.alert("Error", "Failed to set primary PV system.");
    }
  };

  const toggleNotifications = async () => {
    setLoading(true);
    try {
      const newValue = !isEnabled;

      if (newValue) {
        // Enable notifications
        const token = await registerForPushNotificationsAsync();

        if (token) {
          // Schedule the daily notifications
          await scheduleMorningNotification();
          await scheduleEveningNotification();

          // Save the new status
          await AsyncStorage.setItem(NOTIFICATIONS_ENABLED_KEY, "true");
          setIsEnabled(true);

          // Show confirmation
          Alert.alert(
            "Notifications Enabled",
            "You will receive morning and evening notifications about your solar system."
          );
        }
      } else {
        // Disable notifications
        await cancelAllNotifications();
        await AsyncStorage.setItem(NOTIFICATIONS_ENABLED_KEY, "false");
        setIsEnabled(false);

        // Show confirmation
        Alert.alert(
          "Notifications Disabled",
          "You will no longer receive notifications."
        );
      }

      // Update the list of scheduled notifications
      await loadScheduledNotifications();
    } catch (error) {
      console.error("Error toggling notifications:", error);
      Alert.alert("Error", "Failed to update notification settings.");
    } finally {
      setLoading(false);
    }
  };

  const handleSendDemoNotification = async (type: "morning" | "evening") => {
    try {
      await sendDemoNotification(type);
      Alert.alert(
        "Demo Notification Sent",
        `A demo ${type} notification has been sent. You should receive it shortly.`
      );
    } catch (error) {
      console.error("Error sending demo notification:", error);
      Alert.alert("Error", "Failed to send demo notification.");
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.title}>Notification Settings</Text>

        <View style={styles.switchContainer}>
          <Text>Daily Notifications</Text>
          <Switch
            value={isEnabled}
            onValueChange={toggleNotifications}
            disabled={loading}
          />
        </View>

        <Text style={styles.description}>
          When enabled, you will receive daily notifications at 9am and 6pm with
          updates about your solar system's performance.
        </Text>
      </View>

      {/* PV System Selector */}
      <View style={styles.section}>
        <Text style={styles.subtitle}>Primary System for Notifications</Text>
        <Menu
          visible={menuVisible}
          onDismiss={() => setMenuVisible(false)}
          anchor={
            <List.Item
              title="Select PV System"
              description={selectedPvSystemName || "Not selected"}
              onPress={() => setMenuVisible(true)}
              right={(props) =>
                loadingSystems ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <List.Icon {...props} icon="menu-down" />
                )
              }
              style={styles.systemSelector}
            />
          }
        >
          {pvSystems.map((system) => (
            <Menu.Item
              key={system.pvSystemId}
              title={system.name}
              onPress={() =>
                handleSelectPvSystem(system.pvSystemId, system.name)
              }
            />
          ))}
        </Menu>

        <Text style={styles.description}>
          Select which solar system should be used for daily production
          notifications.
        </Text>
      </View>

      <Divider style={styles.divider} />

      {isEnabled && (
        <View style={styles.section}>
          <Text style={styles.subtitle}>Demo Notifications</Text>
          <Text style={styles.description}>
            Send a test notification to preview how they will appear on your
            device.
          </Text>

          <View style={styles.buttonContainer}>
            <Button
              mode="contained"
              onPress={() => handleSendDemoNotification("morning")}
              style={styles.button}
              disabled={loading}
            >
              Morning Demo
            </Button>

            <Button
              mode="contained"
              onPress={() => handleSendDemoNotification("evening")}
              style={styles.button}
              disabled={loading}
            >
              Evening Demo
            </Button>
          </View>
        </View>
      )}

      {scheduledNotifications.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.subtitle}>Scheduled Notifications</Text>
          <Text style={styles.description}>
            {scheduledNotifications.length} notification(s) scheduled
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
    backgroundColor: "#fff",
    borderRadius: 8,
    marginBottom: 16,
  },
  section: {
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: "#666",
    marginBottom: 16,
  },
  switchContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  buttonContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  button: {
    flex: 1,
    marginHorizontal: 5,
  },
  systemSelector: {
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    marginBottom: 8,
  },
  divider: {
    marginBottom: 16,
  },
});

export default NotificationSettings;

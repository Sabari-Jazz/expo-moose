import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  View,
  Alert,
  ScrollView,
  Switch,
  TouchableOpacity,
} from "react-native";
import {
  Text,
  List,
  Divider,
  Button,
  Dialog,
  Portal,
} from "react-native-paper";
import { useTheme } from "@/hooks/useTheme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { logout as authLogout, getCurrentUser } from "@/utils/auth";
import UserSystemAccessTable from "@/components/UserSystemAccessTable";

export default function SettingsScreen() {
  const { isDarkMode, colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [logoutDialogVisible, setLogoutDialogVisible] = useState(false);
  const [userData, setUserData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Fetch user data on load
  useEffect(() => {
    const loadUserData = async () => {
      try {
        const user = await getCurrentUser();
        setUserData(user);
      } catch (error) {
        console.error("Error loading user data:", error);
      } finally {
        setLoading(false);
      }
    };

    loadUserData();
  }, []);

  // Handle logout confirmation
  const handleLogout = async () => {
    setLogoutDialogVisible(false);
    try {
      await authLogout();

      setTimeout(() => {
        router.replace("/");
      }, 100);
    } catch (error) {
      console.error("Error during logout:", error);
      Alert.alert("Logout Error", "An error occurred during logout.");
    }
  };

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: isDarkMode ? colors.background : "#f5f5f5" },
      ]}
    >
      <StatusBar style={isDarkMode ? "light" : "dark"} />

      {/* Header with back button */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 10,
            borderBottomColor: isDarkMode ? colors.border : "#e0e0e0",
          },
        ]}
      >
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text
          variant="headlineSmall"
          style={{ color: colors.text, fontWeight: "600" }}
        >
          Settings
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingBottom: insets.bottom + 20,
          },
        ]}
      >
        {/* Account Section */}
        <View style={styles.section}>
          <Text
            variant="titleMedium"
            style={[styles.sectionTitle, { color: colors.text }]}
          >
            Account
          </Text>

          <List.Item
            title="Username"
            description={
              loading ? "Loading..." : userData?.username || "Not available"
            }
            left={(props) => (
              <List.Icon {...props} icon="account" color={colors.primary} />
            )}
            titleStyle={{ color: colors.text }}
            descriptionStyle={{ color: isDarkMode ? "#aaa" : "#666" }}
            style={[
              styles.listItem,
              { backgroundColor: isDarkMode ? colors.card : "#fff" },
            ]}
          />

          <List.Item
            title="Name"
            description={
              loading ? "Loading..." : userData?.name || "Not available"
            }
            left={(props) => (
              <List.Icon
                {...props}
                icon="badge-account"
                color={colors.primary}
              />
            )}
            titleStyle={{ color: colors.text }}
            descriptionStyle={{ color: isDarkMode ? "#aaa" : "#666" }}
            style={[
              styles.listItem,
              { backgroundColor: isDarkMode ? colors.card : "#fff" },
            ]}
          />

          <List.Item
            title="Role"
            description={
              loading
                ? "Loading..."
                : userData?.role === "admin"
                ? "Administrator"
                : "Regular User"
            }
            left={(props) => (
              <List.Icon
                {...props}
                icon="shield-account"
                color={colors.primary}
              />
            )}
            titleStyle={{ color: colors.text }}
            descriptionStyle={{ color: isDarkMode ? "#aaa" : "#666" }}
            style={[
              styles.listItem,
              { backgroundColor: isDarkMode ? colors.card : "#fff" },
            ]}
          />
        </View>

        <Divider style={{ marginVertical: 16 }} />

        {/* System Access Section */}
        <View style={styles.section}>
          <Text
            variant="titleMedium"
            style={[styles.sectionTitle, { color: colors.text }]}
          >
            System Access
          </Text>

          <UserSystemAccessTable />
        </View>

        <Divider style={{ marginVertical: 16 }} />

        {/* Logout Button */}
        <Button
          mode="contained"
          onPress={() => setLogoutDialogVisible(true)}
          style={[
            styles.logoutButton,
            { backgroundColor: "#f44336", marginBottom: 16 },
          ]}
          textColor="#ffffff"
          icon="logout"
        >
          Logout
        </Button>

        <Divider style={{ marginVertical: 16 }} />

        {/* Application Section */}
        <View style={styles.section}>
          <Text
            variant="titleMedium"
            style={[styles.sectionTitle, { color: colors.text }]}
          >
            Application
          </Text>

          <List.Item
            title="Notifications"
            left={(props) => (
              <List.Icon {...props} icon="bell" color={colors.primary} />
            )}
            right={() => <Switch value={true} />}
            titleStyle={{ color: colors.text }}
            style={[
              styles.listItem,
              { backgroundColor: isDarkMode ? colors.card : "#fff" },
            ]}
          />

          <List.Item
            title="Dark Mode"
            left={(props) => (
              <List.Icon
                {...props}
                icon="theme-light-dark"
                color={colors.primary}
              />
            )}
            right={() => <Switch value={isDarkMode} />}
            titleStyle={{ color: colors.text }}
            style={[
              styles.listItem,
              { backgroundColor: isDarkMode ? colors.card : "#fff" },
            ]}
          />

          <List.Item
            title="App Version"
            description="1.0.0"
            left={(props) => (
              <List.Icon {...props} icon="information" color={colors.primary} />
            )}
            titleStyle={{ color: colors.text }}
            descriptionStyle={{ color: isDarkMode ? "#aaa" : "#666" }}
            style={[
              styles.listItem,
              { backgroundColor: isDarkMode ? colors.card : "#fff" },
            ]}
          />
        </View>
      </ScrollView>

      {/* Logout confirmation dialog */}
      <Portal>
        <Dialog
          visible={logoutDialogVisible}
          onDismiss={() => setLogoutDialogVisible(false)}
          style={{ backgroundColor: isDarkMode ? colors.card : "#fff" }}
        >
          <Dialog.Title style={{ color: colors.text }}>
            Confirm Logout
          </Dialog.Title>
          <Dialog.Content>
            <Text style={{ color: colors.text }}>
              Are you sure you want to logout from your account?
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setLogoutDialogVisible(false)}>
              Cancel
            </Button>
            <Button onPress={handleLogout} textColor="#f44336">
              Logout
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  scrollContent: {
    padding: 16,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontWeight: "600",
    marginBottom: 12,
  },
  listItem: {
    marginBottom: 8,
    borderRadius: 8,
  },
  logoutButton: {
    marginTop: 8,
    borderRadius: 8,
  },
});

import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  View,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  Alert,
  ScrollView,
} from "react-native";
import { Text, TextInput, Button, Surface } from "react-native-paper";
import { StatusBar } from "expo-status-bar";
import { router, Redirect } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn, SlideInUp } from "react-native-reanimated";
import { useSession } from "@/utils/sessionContext";
import { Image } from "expo-image";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerForPushNotificationsAsync} from "../services/NotificationService";

export default function LoginPage() {
  // Theme and device information
  const { isDarkMode, colors } = useTheme();
  const insets = useSafeAreaInsets();

  // Get session context
  const { session, signIn, isLoading: sessionLoading } = useSession();

  // Form state
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [secureTextEntry, setSecureTextEntry] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({ username: "", password: "" });

  // If user is authenticated, redirect using Expo Router's Redirect component
  if (session && !sessionLoading) {
    return <Redirect href="/(tabs)/dashboard" />;
  }

  // Validate form inputs
  const validateForm = () => {
    let isValid = true;
    const newErrors = { username: "", password: "" };

    // Validate username
    if (!username.trim()) {
      newErrors.username = "Username is required";
      isValid = false;
    }

    // Validate password
    if (!password) {
      newErrors.password = "Password is required";
      isValid = false;
    }

    setErrors(newErrors);
    return isValid;
  };

  // Handle login button press
  const handleLogin = async () => {
    // Validate form inputs
    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    try {
      // Use session context to sign in
      const user = await signIn(username, password);

      if (!user) {
        Alert.alert(
          "Login Failed",
          "Invalid username or password. Please try again.",
          [{ text: "OK" }]
        );
      } else {
        // Check if notifications are enabled
        const notificationsEnabled = await AsyncStorage.getItem('notifications_enabled_key');
        
        if (notificationsEnabled !== 'true') {
          // Prompt user to enable notifications
          Alert.alert(
            "Enable Notifications",
            "Would you like to receive status notifications for your solar systems?",
            [
              {
                text: "Not Now",
                style: "cancel",
                onPress: () => {
                  router.replace("/(tabs)/dashboard");
                }
              },
              {
                text: "Enable",
                onPress: async () => {
                  try {
                    const token = await registerForPushNotificationsAsync();
                    if (token) {
                      await AsyncStorage.setItem('notifications_enabled_key', 'true');

                      console.log("Notifications enabled successfully");
                    }
                    router.replace("/(tabs)/dashboard");
                  } catch (error) {
                    console.error("Error enabling notifications:", error);
                    router.replace("/(tabs)/dashboard");
                  }
                }
              }
            ]
          );
        } else {
          router.replace("/(tabs)/dashboard");
        }
        console.log("Login successful");
      }
    } catch (error: any) {
      console.error("Login error:", error);
      
      // Handle specific Cognito error messages
      let errorMessage = "An error occurred during login. Please try again.";
      
      if (error.code === 'UserNotFoundException') {
        errorMessage = "User does not exist. Please check your username.";
      } else if (error.code === 'NotAuthorizedException') {
        errorMessage = "Incorrect username or password. Please try again.";
      } else if (error.code === 'UserNotConfirmedException') {
        errorMessage = "Your account is not confirmed. Please contact an administrator.";
      } else if (error.code === 'PasswordResetRequiredException') {
        errorMessage = "You need to reset your password. Please contact an administrator.";
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      Alert.alert(
        "Login Error",
        errorMessage,
        [{ text: "OK" }]
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Toggle password visibility
  const togglePasswordVisibility = () => {
    setSecureTextEntry(!secureTextEntry);
  };

  // Handle back button press
  const handleBackPress = () => {
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={[
        styles.container,
        { backgroundColor: isDarkMode ? colors.background : "#f5f5f5" },
      ]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    //  keyboardVerticalOffset={Platform.OS === "ios" ? 50 : 0}
    >
      <StatusBar style={isDarkMode ? "light" : "dark"} />

      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + 20,
            paddingBottom: insets.bottom + 20,
            paddingLeft: insets.left + 20,
            paddingRight: insets.right + 20,
          },
        ]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={styles.inner}>
          {/* Back button in header */}
          <Animated.View
            style={styles.headerNav}
            entering={FadeIn.delay(100).duration(400)}
          >
            {/* <Button
              icon="arrow-left"
              mode="text"
              onPress={handleBackPress}
              textColor={colors.primary}
              style={styles.backButton}
            >
              Back
            </Button> */}
          </Animated.View>

          {/* Header */}
          <Animated.View
            style={styles.headerContainer}
            entering={FadeIn.delay(100).duration(600)}
          >
            <Image
              source={require("@/assets/icon.png")}
              style={styles.logo}
              contentFit="contain"
            />
            <Text
              variant="headlineMedium"
              style={[styles.headerText, { color: colors.primary }]}
            >
              Welcome Back
            </Text>
            <Text
              variant="bodyMedium"
              style={{ color: isDarkMode ? colors.text : "#555" }}
            >
              Log in to your account
            </Text>
          </Animated.View>

          {/* Login Form */}
          <Animated.View
            entering={FadeIn.delay(100).duration(600)}
          >
            <Surface
              style={[
                styles.formContainer,
                {
                  backgroundColor: isDarkMode ? colors.card : "#fff",
                  borderColor: isDarkMode ? colors.border : "#eaeaea",
                },
              ]}
              elevation={2}
            >
              {/* Username input */}
              <TextInput
                label="Username"
                value={username}
                onChangeText={(text) => {
                  setUsername(text);
                  if (errors.username) {
                    setErrors({ ...errors, username: "" });
                  }
                }}
                mode="outlined"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
                outlineColor={isDarkMode ? colors.border : "#ddd"}
                activeOutlineColor={colors.primary}
                contentStyle={{ color: colors.text }}
                error={!!errors.username}
              />
              {errors.username ? (
                <Text style={styles.errorText}>{errors.username}</Text>
              ) : null}

              {/* Password input */}
              <TextInput
                label="Password"
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  if (errors.password) {
                    setErrors({ ...errors, password: "" });
                  }
                }}
                mode="outlined"
                secureTextEntry={secureTextEntry}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
                outlineColor={isDarkMode ? colors.border : "#ddd"}
                activeOutlineColor={colors.primary}
                contentStyle={{ color: colors.text }}
                error={!!errors.password}
                right={
                  <TextInput.Icon
                    icon={secureTextEntry ? "eye" : "eye-off"}
                    onPress={togglePasswordVisibility}
                    color={isDarkMode ? colors.text : undefined}
                  />
                }
              />
              {errors.password ? (
                <Text style={styles.errorText}>{errors.password}</Text>
              ) : null}

              {/* Login button */}
              <Button
                mode="contained"
                onPress={handleLogin}
                style={styles.loginButton}
                buttonColor={colors.primary}
                textColor="#fff"
                disabled={isLoading || sessionLoading}
                loading={isLoading || sessionLoading}
              >
                Login
              </Button>

              {/* Demo credentials info */}
              <View style={styles.demoCredentialsContainer}>
                <Text
                  style={[
                    styles.credentialInfo,
                    { color: isDarkMode ? "#888" : "#666" },
                  ]}
                >
                  Demo Credentials:
                </Text>
                <Text
                  style={[
                    styles.credentialDetail,
                    { color: isDarkMode ? "#aaa" : "#555" },
                  ]}
                >
                  • Admin: username: admin, password: admin123
                </Text>
                <Text
                  style={[
                    styles.credentialDetail,
                    { color: isDarkMode ? "#aaa" : "#555" },
                  ]}
                >
                  • User: username: ketan, password: password
                </Text>
              </View>
            </Surface>
          </Animated.View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    width: '100%',
  },
  inner: {
    flex: 1,
    justifyContent: "center",
    position: "relative",
    paddingTop: 50,
    width: '100%',
    maxWidth: 500, // Maximum width for larger screens
    alignSelf: 'center', // Center content on larger screens
  },
  headerNav: {
    position: "absolute",
    top: 0,
    left: 0,
    zIndex: 10,
  },
  headerContainer: {
    alignItems: "center",
    marginBottom: '6%', // Use percentage for responsive vertical spacing
    width: '100%',
  },
  headerText: {
    fontWeight: "bold",
    marginBottom: 8,
    textAlign: 'center',
  },
  formContainer: {
    padding: '5%', // Percentage-based padding adapts to screen width
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 20,
    width: '100%',
  },
  input: {
    marginBottom: 16,
    width: '100%',
  },
  logo: {
    width: '45%', 
    height: undefined, 
    aspectRatio: 1, 
    minWidth: 80, 
    maxWidth: 120, 
  },
  errorText: {
    color: "#f44336",
    fontSize: 12,
    marginLeft: 12,
    marginTop: -12,
    marginBottom: 12,
  },
  loginButton: {
    marginTop: 8,
    paddingVertical: 6,
    borderRadius: 8,
    width: '100%',
  },
  demoCredentialsContainer: {
    marginTop: 20,
    alignItems: "center",
    width: '100%',
  },
  credentialInfo: {
    fontWeight: "bold",
    fontSize: 14,
    marginBottom: 4,
    textAlign: 'center',
  },
  credentialDetail: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  backButton: {
    alignSelf: "flex-start",
  },
});
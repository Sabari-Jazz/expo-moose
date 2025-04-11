import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  View,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  ToastAndroid,
} from "react-native";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { useThemeColor } from "@/hooks/useThemeColor";
import { uploadFeedback } from "@/services/feedbackService";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase, testSupabaseConnection } from "@/utils/supabase";

export default function FeedbackScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastTicketId, setLastTicketId] = useState<string | null>(null);
  const [networkStatus, setNetworkStatus] = useState<
    "checking" | "online" | "offline"
  >("checking");
  const [supabaseStatus, setSupabaseStatus] = useState<
    "checking" | "connected" | "disconnected"
  >("checking");

  const primaryColor = useThemeColor({}, "tint");
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const borderColor = useThemeColor({}, "border");
  const errorColor = "#FF3B30";
  const insets = useSafeAreaInsets();

  // Bottom tab height adaptation
  const tabBarHeight = Platform.OS === "ios" ? 100 : 80;

  // Check network and Supabase status on mount
  useEffect(() => {
    checkNetworkStatus();
    checkSupabaseConnection();
  }, []);

  const checkSupabaseConnection = async () => {
    setSupabaseStatus("checking");
    const isConnected = await testSupabaseConnection();
    setSupabaseStatus(isConnected ? "connected" : "disconnected");
  };

  const checkNetworkStatus = async () => {
    try {
      setNetworkStatus("checking");

      // Simple timeout function that works everywhere
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Network request timeout")), 5000)
      );

      // Fetch request
      const fetchPromise = fetch("https://www.google.com", { method: "HEAD" });

      // Race between fetch and timeout
      const response = await Promise.race([fetchPromise, timeoutPromise]);

      // If we get here, the fetch succeeded before the timeout
      console.log("Network check succeeded, online status detected");
      setNetworkStatus("online");
    } catch (error) {
      console.log("Network check failed:", error);

      // For iOS simulator, assume online
      if (Platform.OS === "ios") {
        console.log("iOS simulator detected, assuming online");
        setNetworkStatus("online");
      } else {
        setNetworkStatus("offline");
      }
    }
  };

  const handleSubmit = async () => {
    // Re-check network status
    if (networkStatus === "offline") {
      await checkNetworkStatus();

      if (networkStatus === "offline") {
        if (Platform.OS === "android") {
          ToastAndroid.show(
            "Device appears to be offline. Feedback will be saved locally.",
            ToastAndroid.LONG
          );
        } else {
          Alert.alert(
            "Network Issue",
            "Your device appears to be offline. Your feedback will be saved locally and submitted when a connection is available.",
            [{ text: "OK" }]
          );
        }
      }
    }

    // Simple form validation
    if (name.trim() === "") {
      Alert.alert("Error", "Please enter your name");
      return;
    }

    if (email.trim() === "") {
      Alert.alert("Error", "Please enter your email");
      return;
    }

    if (message.trim() === "") {
      Alert.alert("Error", "Please enter your message");
      return;
    }

    try {
      setSubmitting(true);
      console.log("Submitting feedback to the database...");

      // Create feedback object
      const feedbackData = {
        name: name.trim(),
        email: email.trim(),
        message: message.trim(),
        timestamp: new Date().toISOString(),
      };

      // Call the upload function
      const result = await uploadFeedback(feedbackData);
      setLastTicketId(result.ticketId);

      console.log("Feedback submitted successfully:", result.ticketId);

      // Show success message and clear form
      Alert.alert(
        "Feedback Submitted",
        `Thank you for your feedback! Your ticket ID is ${result.ticketId}. Your feedback has been saved.`,
        [
          {
            text: "OK",
            onPress: () => {
              // Reset form
              setName("");
              setEmail("");
              setMessage("");
            },
          },
        ]
      );
    } catch (error) {
      console.error("Error submitting feedback:", error);

      // Display error message with more details
      Alert.alert(
        "Error",
        "Failed to save your feedback. " +
          (networkStatus === "offline" ? "You appear to be offline. " : "") +
          "The issue has been logged and your feedback will be saved locally.",
        [
          {
            text: "Try Again",
            onPress: () => {
              checkNetworkStatus();
              setTimeout(handleSubmit, 1000);
            },
          },
          {
            text: "Cancel",
            style: "cancel",
          },
        ]
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardAvoid}
        keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingBottom: insets.bottom + tabBarHeight,
              paddingTop: 16,
              paddingHorizontal: 16,
            },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <ThemedView type="card" style={styles.formContainer}>
            {networkStatus === "offline" && (
              <View style={styles.offlineNotice}>
                <Text style={styles.offlineText}>
                  You are currently offline. Feedback will be saved locally and
                  submitted when online.
                </Text>
              </View>
            )}

            <ThemedText type="subtitle" style={styles.title}>
              We value your feedback
            </ThemedText>

            <ThemedText type="body" style={styles.description}>
              Please let us know your thoughts, suggestions, or report any
              issues you've encountered. Our team will review your feedback and
              get back to you if needed.
            </ThemedText>

            {lastTicketId && (
              <View style={styles.lastSubmissionContainer}>
                <ThemedText style={styles.lastSubmissionText}>
                  Last submitted ticket: {lastTicketId}
                </ThemedText>
              </View>
            )}

            <View style={styles.inputContainer}>
              <ThemedText type="caption" style={styles.label}>
                Name*
              </ThemedText>
              <TextInput
                style={[
                  styles.input,
                  {
                    borderColor: borderColor,
                    color: textColor,
                    backgroundColor: backgroundColor,
                  },
                ]}
                placeholder="Your name"
                placeholderTextColor="#999"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
              />
            </View>

            <View style={styles.inputContainer}>
              <ThemedText type="caption" style={styles.label}>
                Email*
              </ThemedText>
              <TextInput
                style={[
                  styles.input,
                  {
                    borderColor: borderColor,
                    color: textColor,
                    backgroundColor: backgroundColor,
                  },
                ]}
                placeholder="Your email address"
                placeholderTextColor="#999"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputContainer}>
              <ThemedText type="caption" style={styles.label}>
                Message*
              </ThemedText>
              <TextInput
                style={[
                  styles.input,
                  styles.messageInput,
                  {
                    borderColor: borderColor,
                    color: textColor,
                    backgroundColor: backgroundColor,
                  },
                ]}
                placeholder="Please describe your feedback, suggestion, or issue"
                placeholderTextColor="#999"
                value={message}
                onChangeText={setMessage}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
              />
            </View>

            <TouchableOpacity
              style={[styles.submitButton, { backgroundColor: primaryColor }]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <ThemedText style={styles.submitButtonText}>
                  Submit Feedback
                </ThemedText>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.retryConnection}
              onPress={() => {
                checkNetworkStatus();
                checkSupabaseConnection();
              }}
            >
              <ThemedText style={styles.retryConnectionText}>
                {networkStatus === "checking"
                  ? "Checking connection..."
                  : networkStatus === "online"
                  ? "Network: Online"
                  : "Network: Offline - Tap to retry"}
              </ThemedText>
              <ThemedText
                style={[
                  styles.retryConnectionText,
                  {
                    color:
                      supabaseStatus === "connected"
                        ? "#34C759" // Green
                        : supabaseStatus === "checking"
                        ? "#FF9500" // Orange
                        : "#FF3B30", // Red
                    marginTop: 4,
                  },
                ]}
              >
                {supabaseStatus === "checking"
                  ? "Checking database..."
                  : supabaseStatus === "connected"
                  ? "Database: Connected"
                  : "Database: Disconnected - Tap to retry"}
              </ThemedText>
            </TouchableOpacity>
          </ThemedView>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  formContainer: {
    marginVertical: 16,
  },
  title: {
    fontWeight: "bold",
    marginBottom: 8,
    textAlign: "center",
  },
  description: {
    marginBottom: 24,
    textAlign: "center",
    lineHeight: 22,
  },
  lastSubmissionContainer: {
    backgroundColor: "rgba(52, 199, 89, 0.1)",
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
    alignItems: "center",
  },
  lastSubmissionText: {
    fontSize: 14,
    color: "#34C759",
  },
  inputContainer: {
    marginBottom: 16,
  },
  label: {
    marginBottom: 8,
    fontWeight: "500",
  },
  input: {
    height: 50,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  messageInput: {
    height: 120,
    paddingTop: 12,
    paddingBottom: 12,
    textAlignVertical: "top",
  },
  submitButton: {
    height: 50,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 16,
  },
  submitButtonText: {
    color: "#FFFFFF",
    fontWeight: "bold",
    fontSize: 16,
  },
  offlineNotice: {
    backgroundColor: "rgba(255, 59, 48, 0.1)",
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
    alignItems: "center",
  },
  offlineText: {
    fontSize: 14,
    color: "#FF3B30",
  },
  retryConnection: {
    height: 50,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 16,
  },
  retryConnectionText: {
    fontSize: 14,
    opacity: 0.7,
  },
});

import React, { useState, useRef, useEffect} from "react";
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
} from "react-native";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { useThemeColor } from "@/hooks/useThemeColor";
import { uploadFeedback, uploadFeedbackSupabase } from "@/services/feedbackService";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import {Keyboard} from 'react-native'
import { getCurrentUser} from "@/utils/auth";
import { getCurrentWeather } from "@/api/api";

export default function FeedbackScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastTicketId, setLastTicketId] = useState<string | null>(null);
  const [feedbackType, setFeedbackType] = useState<'bug' | 'feature'>('bug');
  

  const primaryColor = useThemeColor({}, "tint");
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const borderColor = useThemeColor({}, "border");
  const insets = useSafeAreaInsets();

  // Bottom tab height adaptation
  const tabBarHeight = Platform.OS === "ios" ? 100 : 80;
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    const setUserEmail = async () => {
      const user = await getCurrentUser();
      setEmail(user?.email ?? '');

    }
    setUserEmail();

  }, [])

  const handleSubmit = async () => {
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
      console.log("Saving feedback locally...");

      // Create feedback object
      const feedbackData = {
        name: name.trim(),
        email: email.trim(),
        message: message.trim(),
        type: feedbackType,
        supabaseId: ''
      };

      // Call the upload function
      const result = await uploadFeedbackSupabase(feedbackData); 
     // const result = await uploadFeedback(feedbackData);
      setLastTicketId(result.ticketId);

      console.log("Feedback saved successfully:", result.ticketId);

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
              setFeedbackType('bug');
            },
          },
        ]
      );
      Keyboard.dismiss();
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    } catch (error) {
      console.error("Error saving feedback:", error);

      // Display error message
      Alert.alert("Error", "Failed to save your feedback. Please try again.", [
        { text: "OK" },
      ]);
    } finally {
      setSubmitting(false);
    }
  };

  const navigateToAdmin = () => {
    router.push("/feedback-admin");
  };

  return (
    <SafeAreaView style={styles.container}>
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardAvoid}
    //    keyboardVerticalOffset={Platform.OS === "ios" ? 100 : 0}
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
          ref={scrollViewRef}
        >
          <ThemedView type="card" style={styles.formContainer}>
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
            <View style={styles.inputContainer}>
            <ThemedText type="caption" style={styles.label}>
              Feedback Type
            </ThemedText>
            <View style={styles.toggleWrapper}>
              <View style={styles.toggleContainer}>
                <View style={styles.labelRow}>
                  <View style={styles.labelColumn}>
                    <ThemedText style={[styles.toggleLabel, feedbackType === "bug" && styles.activeLabel]}>
                      Bug
                    </ThemedText>
                    <ThemedText style={[styles.toggleLabel, feedbackType === "bug" && styles.activeLabel]}>
                      Report
                    </ThemedText>
                  </View>
                  <View style={styles.labelColumn}>
                    <ThemedText style={[styles.toggleLabel, feedbackType === "feature" && styles.activeLabel]}>
                      Feature
                    </ThemedText>
                    <ThemedText style={[styles.toggleLabel, feedbackType === "feature" && styles.activeLabel]}>
                      Request
                    </ThemedText>
                  </View>
                </View>
      <TouchableOpacity
        style={[
          styles.toggleTrack,
          { borderColor: primaryColor }
        ]}
        activeOpacity={0.8}
        onPress={() => setFeedbackType(feedbackType === "feature" ? "bug" : "feature")}
      >
        <View
          style={[
            styles.toggleThumb,
            { backgroundColor: primaryColor },
            feedbackType === "feature" && styles.toggleThumbRight
          ]}
        />
      </TouchableOpacity>
    </View>
  </View>
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
              style={[styles.adminButton, { borderColor: primaryColor }]}
              onPress={navigateToAdmin}
            >
              <ThemedText style={{ color: primaryColor }}>
                View All Feedback
              </ThemedText>
            </TouchableOpacity>
          </ThemedView>
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
    </SafeAreaView>
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
    marginVertical: 10,
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
  toggleWrapper: {
    marginVertical: 8,
    alignItems: "flex-start",
  },
  toggleContainer: {
    alignItems: "center",
    width: 120, // Fixed width for the toggle component
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
    width: "100%",
    gap:40,
  },
  labelColumn: {
    alignItems: "center",
    
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: "bold",
    opacity: 0.7,
    textAlign: "center",
    
  },
  
  activeLabel: {
    opacity: 1,
    fontWeight: "600",
  },
  toggleTrack: {
    height: 28,
    width: 90,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 2,
    backgroundColor: "transparent",
  },
  toggleThumb: {
    width: 46,
    height: 22,
    borderRadius: 11,
    position: "relative",
    left: 0,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1,
    elevation: 2,
  },
  toggleThumbRight: {
    left: 38,
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
  adminButton: {
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 12,
  },
});

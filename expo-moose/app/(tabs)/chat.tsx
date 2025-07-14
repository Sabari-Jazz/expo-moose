import React, { useState, useRef, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  FlatList,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
  Keyboard,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
} from "react-native";
import axios from "axios";
import Markdown from "react-native-markdown-display"; // Import the markdown display library
import { Image } from "expo-image";
import { useTheme } from "@/hooks/useTheme";
import { Ionicons } from "@expo/vector-icons";
import KeyboardAwareView from "@/components/KeyboardAwareView";
import { getJwtToken } from "@/api/api";
import { getCurrentUser} from "@/utils/cognitoAuth";
import { User } from "@/utils/cognitoAuth";
import { getAccessibleSystems } from "@/utils/cognitoAuth";
import * as api from "@/api/api";
import { Picker } from '@react-native-picker/picker';
import { SafeAreaView } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Constants from "expo-constants";
import { LineChart } from "@/components/LineChart2";
import { BarChart } from "@/components/BarChart2";
import { API_URL } from "@/constants/api";

// --- API Configuration ---

//const API_URL= 'https://vfcfg6edj6.execute-api.us-east-1.amazonaws.com/api/chat'
//const API_URL = "http://10.0.0.210:8000/chat"; // Local backend API endpoint
//const API_URL = "http://172.17.49.217:8000/chat";
/*
const API_URL = 
  Constants.expoConfig?.extra?.awsApiUrl || 
  process.env.AWS_API_URL;
  */
// const API_URL = "https://ylqco43hbtyqzxgvmuks26efe40algqx.lambda-url.us-east-1.on.aws/";
// --- API Call Function ---
interface ChatRequest {
  username: string;
  message: string;
  user_id?: string;
  jwtToken?: string;
}

interface ChatResponse {
  response: string;
  source_documents?: SourceDocument[];
  chart_data?: ChartData;
}

interface SourceDocument {
  content: string;
  metadata?: any;
}

interface ChartData {
  chart_type: string;
  data_type: string;
  title: string;
  x_axis_label: string;
  y_axis_label: string;
  data_points: Array<{x: string, y: number}>;
  time_period: string;
  total_value?: number;
  unit: string;
  system_name?: string;
}

const getChatResponse = async (message: string, userId: string, systemId: string | null, username: string = 'Guest User', sessionDeviceId: string): Promise<{response: string, chartData?: ChartData}> => {
  try {
    console.log("=== GETCHATRESPONSE START ===");
    console.log("Parameters:");
    console.log("- message:", message);
    console.log("- userId:", userId);
    console.log("- systemId:", systemId);
    console.log("- username:", username);
    console.log("- sessionDeviceId:", sessionDeviceId);
    
    const jwtToken = await getJwtToken();
    
    // Use the provided session device ID to ensure consistency between calls
    
    // Combine the user ID, device ID, and system ID into a single identifier
    // Format: userId_deviceId_systemId
    const combinedId = `${userId}_${sessionDeviceId}${systemId ? `_${systemId}` : ''}`;
    console.log("Combined ID:", combinedId);
    
    const requestData = {
      username: username,
      message: message,
      user_id: combinedId,
      jwtToken: jwtToken
    } as ChatRequest;
    
    console.log("Sending API request with data:", JSON.stringify(requestData, null, 2));
    
    const response = await axios.post<ChatResponse>(API_URL + "/api/chat", requestData);
    
    console.log("Received response from API:", response.data);
    
    // Log chart data specifically
    if (response.data.chart_data) {
      console.log("=== CHART DATA RECEIVED ===");
      console.log("Chart data type:", response.data.chart_data.data_type);
      console.log("Chart title:", response.data.chart_data.title);
      console.log("Chart data points count:", response.data.chart_data.data_points?.length || 0);
      console.log("Chart total value:", response.data.chart_data.total_value);
      console.log("Chart unit:", response.data.chart_data.unit);
      console.log("First 3 data points:", response.data.chart_data.data_points?.slice(0, 3));
      console.log("=== END CHART DATA ===");
    } else {
      console.log("No chart data in response");
    }
    
    if (response.data && response.data.response) {
      console.log("=== GETCHATRESPONSE SUCCESS ===");
      return {
        response: response.data.response,
        chartData: response.data.chart_data
      };
    } else {
      console.error("Unexpected API response structure:", response.data);
      throw new Error("Received unexpected data structure from API");
    }
  } catch (error: unknown) {
    console.log("=== GETCHATRESPONSE ERROR ===");
    if (axios.isAxiosError(error)) {
      if (error.response) {
        console.error("API Error Response Data:", error.response.data);
        console.error("API Error Response Status:", error.response.status);
        console.error("API Error Response Headers:", error.response.headers);
      } else if (error.request) {
        console.error("API Error Request:", error.request);
      }
    } else {
      console.error("API Error Message:", (error as Error).message);
    }
    console.error("Error communicating with API:", error);
    throw new Error("Failed to fetch response from the chat service.");
  }
};

// --- The Chat Screen Component ---
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  chart_data?: ChartData;
}

// System interface for selection
interface PvSystem {
  id: string;
  name: string;
}

// System Selector Props Interface
interface SystemSelectorProps {
  systems: PvSystem[];
  selectedSystemId: string | null;
  setSelectedSystemId: (id: string) => void;
  loadingSystems: boolean;
  isDarkMode: boolean;
  colors: any; // Using any for theme colors
  showSystemModal: boolean;
  setShowSystemModal: (show: boolean) => void;
}

// System Selector Component
const SystemSelector = ({ 
  systems, 
  selectedSystemId, 
  setSelectedSystemId, 
  loadingSystems, 
  isDarkMode, 
  colors, 
  showSystemModal, 
  setShowSystemModal 
}: SystemSelectorProps) => {
  if (loadingSystems) {
    return (
      <View style={styles.systemSelectorContainer}>
        <Text style={[styles.systemSelectorLabel, { color: colors.text }]}>
          Loading systems...
        </Text>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }
  
  if (systems.length === 0) {
    return (
      <View style={styles.systemSelectorContainer}>
        <Text style={[styles.systemSelectorLabel, { color: colors.text }]}>
          No systems available
        </Text>
      </View>
    );
  }

  const currentSystem = systems.find((s: PvSystem) => s.id === selectedSystemId);
  const currentSystemName = currentSystem ? currentSystem.name : "Select system";

  return (
    <View style={styles.systemSelectorContainer}>
      <Text style={[styles.systemSelectorLabel, { color: colors.text }]}>
        Select a system:
      </Text>

      {/* Dropdown button - only for iOS */}
      {Platform.OS === 'ios' && (
        <TouchableOpacity
          style={[
            styles.dropdownButton,
            { 
              backgroundColor: isDarkMode ? colors.card : '#f5f5f5',
              borderColor: colors.primary,
              borderWidth: 1,
            }
          ]}
          onPress={() => setShowSystemModal(true)}
        >
          <Text style={[styles.dropdownButtonText, { color: colors.text }]}>
            {currentSystemName}
          </Text>
          <Ionicons 
            name="chevron-down" 
            size={18} 
            color={colors.text} 
          />
        </TouchableOpacity>
      )}
      
      {/* System selection modal for iOS */}
      {Platform.OS === 'ios' && (
        <Modal
          visible={showSystemModal}
          transparent={true}
          animationType="none"
          onRequestClose={() => setShowSystemModal(false)}
        >
          <View style={styles.modalOverlay}>
            <TouchableOpacity
              style={styles.modalOverlayTouch}
              activeOpacity={1}
              onPress={() => setShowSystemModal(false)}
            />
            <View 
              style={[
                styles.modalContent, 
                {
                  backgroundColor: isDarkMode ? colors.card : '#fff',
                  borderColor: colors.border,
                }
              ]}
            >
              <Text 
                style={[
                  styles.modalTitle, 
                  { color: colors.text }
                ]}
              >
                Select a System
              </Text>
              
              <FlatList
                data={systems}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.modalItem,
                      selectedSystemId === item.id && {
                        backgroundColor: isDarkMode 
                          ? 'rgba(59, 130, 246, 0.2)' 
                          : 'rgba(59, 130, 246, 0.1)'
                      }
                    ]}
                    onPress={() => {
                      setSelectedSystemId(item.id);
                      setShowSystemModal(false);
                    }}
                  >
                    <Text style={[styles.modalItemText, { color: colors.text }]}>
                      {item.name}
                    </Text>
                    {selectedSystemId === item.id && (
                      <Ionicons name="checkmark" size={24} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                )}
              />
              
              <TouchableOpacity
                style={[
                  styles.closeButton,
                  { backgroundColor: colors.primary }
                ]}
                onPress={() => setShowSystemModal(false)}
              >
                <Text style={styles.closeButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
      
      {/* Android native Picker */}
      {Platform.OS === 'android' && (
        <View style={[
          styles.pickerContainer, 
          { 
            backgroundColor: isDarkMode ? colors.background : '#f5f5f5',
            borderColor: colors.primary,
            borderWidth: 1,
          }
        ]}>
          <Picker
            selectedValue={selectedSystemId}
            onValueChange={(value: string | null) => {
              if (value) { // Ensure value is not null
                setSelectedSystemId(value);
              }
            }}
            style={[
              styles.picker, 
              { 
                color: colors.text,
                // Add specific styles to fix text positioning
                textAlignVertical: 'center',
              }
            ]}
            itemStyle={{ 
              height: 55, 
              fontSize: 16,
              fontFamily: 'sans-serif',
            }}
            dropdownIconColor={colors.primary}
          >
            {systems.map((system: PvSystem) => (
              <Picker.Item 
                key={system.id} 
                label={system.name}
                value={system.id}
                // Add style to improve vertical centering and visibility
                style={{
                  fontSize: 16,
                }}
              />
            ))}
          </Picker>
        </View>
      )}
    </View>
  );
};

export default function ChatScreen() {
  const { isDarkMode, colors } = useTheme();
  const tabBarHeight = useBottomTabBarHeight();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [dotCount, setDotCount] = useState(1); // For animated dots
  
  // Add state to track Android keyboard height
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);
  
  // Replace direct state management with animated values
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  
  const flatListRef = useRef<FlatList>(null);
  const loadingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<TextInput>(null);
  const userId = useRef(`user_${Math.random().toString(36).substring(2, 9)}`);
  // Generate a device identifier that remains consistent for the entire session
  const deviceId = useRef(`device_${Platform.OS}_${Math.random().toString(36).substring(2, 9)}`);
  const [user, setUser] = useState<Omit<User, 'password'> | null>(null);
  const [systems, setSystems] = useState<PvSystem[]>([]);
  const [selectedSystemId, setSelectedSystemId] = useState<string | null>(null);
  const [loadingSystems, setLoadingSystems] = useState(true);
  const [showSystemModal, setShowSystemModal] = useState(false);

  // Set a default selected system if none is selected
  useEffect(() => {
    if (systems.length > 0 && !selectedSystemId) {
      console.log("Setting default system:", systems[0].id);
      setSelectedSystemId(systems[0].id);
    }
  }, [systems]);

  // Load user and their systems
  useEffect(() => {
    const loadUserAndSystems = async () => {
      try {
        // Get current user
        const currentUser = await getCurrentUser();
        console.log("Current user:", currentUser);
        setUser(currentUser);
        
        if (currentUser) {
          setLoadingSystems(true);
          
          // Get user's accessible system IDs
          const systemIds = await getAccessibleSystems(currentUser.id);
          console.log("Accessible system IDs:", systemIds);
          
          // Fetch all systems
          const allSystems = await api.getPvSystems(0, 1000);
          console.log("All systems from API:", allSystems);
          
          // Filter to just the accessible systems for this user, or all systems for admin
          let userSystems: PvSystem[] = [];
          
          if (currentUser.role === 'admin' || systemIds.length === 0) {
            // Admin has access to all systems
            userSystems = allSystems.map(sys => ({
              id: sys.pvSystemId,
              name: sys.name
            }));
            console.log("Admin user or empty systemIds - all systems accessible");
          } else {
            // Regular user with specific system access
            userSystems = allSystems
              .filter(sys => systemIds.includes(sys.pvSystemId))
              .map(sys => ({
                id: sys.pvSystemId,
                name: sys.name
              }));
            console.log("Filtered systems for regular user");
          }
          
          console.log("Final user systems:", userSystems);
          setSystems(userSystems);
          
          // Set default selected system if there's only one
          if (userSystems.length === 1) {
            console.log("Only one system available, setting as default:", userSystems[0]);
            setSelectedSystemId(userSystems[0].id);
          }
        }
      } catch (error) {
        console.error("Error loading user and systems:", error);
      } finally {
        setLoadingSystems(false);
      }
    };
    
    loadUserAndSystems();
  }, []);

  // Enhanced keyboard listener
  useEffect(() => {
    const keyboardWillShowListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        // Log keyboard height but use tabBarHeight value
        const keyboardHeight = Math.max(0, e.endCoordinates.height);
        console.log(`Keyboard SHOW event fired - Platform: ${Platform.OS}, Height: ${e.endCoordinates.height}`);
        console.log(`Using tabBarHeight: ${tabBarHeight} instead of keyboard height: ${keyboardHeight}`);
        
        // For Android, use tabBarHeight
        if (Platform.OS === 'android') {
          setAndroidKeyboardHeight(tabBarHeight); // Use exact tabBarHeight
        }
        
        setKeyboardVisible(true);
        
        // Scroll to bottom
        if (flatListRef.current && messages.length > 0) {
          setTimeout(() => {
            flatListRef.current?.scrollToEnd({ animated: true });
          }, 100);
        }
      }
    );
    
    const keyboardWillHideListener = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        console.log(`Keyboard HIDE event fired - Platform: ${Platform.OS}`);
        
        // Reset Android keyboard height
        if (Platform.OS === 'android') {
          setAndroidKeyboardHeight(0);
        }
        
        setKeyboardVisible(false);
      }
    );

    return () => {
      keyboardWillShowListener.remove();
      keyboardWillHideListener.remove();
    };
  }, [messages.length]);

  // Replace the loading message effect with dot animation
  useEffect(() => {
    if (isLoading) {
      // Animate dots (1, 2, 3 dots in sequence)
      loadingIntervalRef.current = setInterval(() => {
        setDotCount((prev) => (prev >= 3 ? 1 : prev + 1));
      }, 500); // Update every 500ms
    } else {
      // Clear interval when not loading
      if (loadingIntervalRef.current) {
        clearInterval(loadingIntervalRef.current);
        loadingIntervalRef.current = null;
      }
      setDotCount(1); // Reset to one dot
    }

    // Cleanup function
    return () => {
      if (loadingIntervalRef.current) {
        clearInterval(loadingIntervalRef.current);
        loadingIntervalRef.current = null;
      }
    };
  }, [isLoading]); // Run effect when isLoading changes

  // --- Handle Sending a Message ---
  const handleSend = async (messageToSend?: string) => {
    const contentToSend = messageToSend ?? input.trim(); // Use provided message or input field

    if (!contentToSend) {
      console.log("Attempting to send empty message.");
      return; // Prevent sending empty message
    }

    console.log("=== HANDLESEND START ===");
    console.log("Content to send:", contentToSend);
    console.log("Selected system ID:", selectedSystemId);
    console.log("User info:", { id: user?.id, name: user?.name });

    const userMessage: ChatMessage = { role: "user", content: contentToSend };

    setMessages((prevMessages) => [...prevMessages, userMessage]);
    if (!messageToSend) {
      // Only clear input if it wasn't a prompt click
      setInput("");
    }
    setIsLoading(true); // Show loading indicator and trigger loading message effect

    try {
      // Pass the selected system ID to the API if one is selected
      const { response, chartData } = await getChatResponse(
        contentToSend, 
        user?.id || 'default_user',
        selectedSystemId,
        user?.name || 'Guest User',
        deviceId.current
      );
      
      console.log("=== RESPONSE RECEIVED IN HANDLESEND ===");
      console.log("Response length:", response.length);
      console.log("Chart data present:", !!chartData);
      if (chartData) {
        console.log("Chart data in handleSend:");
        console.log("- data_type:", chartData.data_type);
        console.log("- title:", chartData.title);
        console.log("- data_points count:", chartData.data_points?.length || 0);
        console.log("- total_value:", chartData.total_value);
      }
      
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: response,
        chart_data: chartData
      };
      
      console.log("Creating assistant message with chart_data:", !!assistantMessage.chart_data);
      setMessages((prevMessages) => [...prevMessages, assistantMessage]);
      console.log("=== HANDLESEND SUCCESS ===");
    } catch (error) {
      console.log("=== HANDLESEND ERROR ===");
      console.error("Error in handleSend:", error);
      const errorMessage: ChatMessage = {
        role: "assistant",
        content: `Sorry, I encountered an error. Please try again.\n*Details: ${
          (error as Error).message
        }*`, // Use markdown for error
      };
      setMessages((prevMessages) => [...prevMessages, errorMessage]);
    } finally {
      setIsLoading(false); // Hide loading indicator and stop loading messages
    }
  };

  // --- Render Each Message Item ---
  const renderMessage = ({ item }: { item: ChatMessage }) => (
    <>
      <View
        style={[
          styles.messageBubble,
          item.role === "user"
            ? [styles.userBubble, { backgroundColor: colors.primary }]
            : [
                styles.assistantBubble,
                { backgroundColor: isDarkMode ? colors.card : "#f0f0f0" },
              ],
        ]}
      >
        <Text
          style={[
            styles.messageRoleText,
            { color: item.role === "user" ? "#fff" : colors.text },
          ]}
        >
          {item.role === "user" ? "You" : "Solar Assistant"}
        </Text>
        {item.role === "assistant" ? (
          <View>
            {/* Use Markdown component for assistant messages */}
            <Markdown style={{
              body: {
                color: colors.text,
                fontSize: 16,
                lineHeight: 22,
              },
              heading1: {
                color: colors.text,
                fontWeight: "bold",
                marginTop: 8,
                marginBottom: 4,
                fontSize: 20,
              },
              heading2: {
                color: colors.text,
                fontWeight: "bold",
                marginTop: 8,
                marginBottom: 4,
                fontSize: 18,
              },
              heading3: {
                color: colors.text,
                fontWeight: "bold",
                marginTop: 6,
                marginBottom: 3,
                fontSize: 16,
              },
              link: {
                color: colors.primary,
              },
              blockquote: {
                backgroundColor: isDarkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)",
                borderLeftColor: colors.primary,
                borderLeftWidth: 4,
                paddingLeft: 8,
                paddingRight: 8,
                paddingTop: 4,
                paddingBottom: 4,
                marginTop: 8,
                marginBottom: 8,
              },
              code_block: {
                backgroundColor: isDarkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)",
                padding: 8,
                borderRadius: 4,
                fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                fontSize: 14,
              },
              code_inline: {
                backgroundColor: isDarkMode ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)",
                fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                padding: 2,
                borderRadius: 2,
                fontSize: 14,
              },
            }}>
              {item.content}
            </Markdown>
          </View>
        ) : (
          // Use standard Text for user messages
          <Text style={[styles.messageContentText, { color: "#fff" }]}>
            {item.content}
          </Text>
        )}
      </View>
      
      {/* Render chart outside the message bubble if chart_data is present */}
      {item.chart_data && (
        <View style={styles.chartContainer}>
          {item.chart_data.chart_type === 'bar' ? (
            <BarChart 
              chartData={item.chart_data}
              isDarkMode={isDarkMode}
              colors={colors}
            />
          ) : (
            <LineChart 
              chartData={item.chart_data}
              isDarkMode={isDarkMode}
              colors={colors}
            />
          )}
        </View>
      )}
    </>
  );

  // --- Handle Clicking Initial Prompts ---
  const handlePromptClick = (promptText: string) => {
    if (isLoading) return; // Prevent multiple submissions
    handleSend(promptText); // Call handleSend directly with the prompt text
  };

  // Get the name of the selected system
  const getSelectedSystemName = (): string | null => {
    if (!selectedSystemId) return null;
    const system = systems.find(s => s.id === selectedSystemId);
    return system ? system.name : null;
  };

  // --- Initial Prompt Buttons ---
  const renderInitialPrompts = () => {
    const systemName = getSelectedSystemName();
    const systemText = systemName ? ` for ${systemName}` : '';
    
    return (
      <View style={styles.initialPromptsContainer}>
        <View style={styles.robotIconPlaceholder}>
          <Image
            source={require("@/assets/icon.png")}
            style={{ width: 100, height: 70 }}
          />
        </View>
        <Text style={[styles.initialTitle, { color: colors.text }]}>
          Hello There!
        </Text>
        <Text style={[styles.initialSubtitle, { color: colors.text }]}>
          What would you like to know about your solar system?
        </Text>


        <TouchableOpacity
          style={[
            styles.promptButton,
            { backgroundColor: isDarkMode ? colors.card : "#f0f0f0" },
          ]}
          onPress={() => handlePromptClick(`What is my energy production today${systemText}?`)}
          disabled={isLoading}
        >
          <Text style={[styles.promptButtonText, { color: colors.text }]}>
            {systemName 
              ? `What is ${systemName}'s energy production today?` 
              : "What is my energy production today?"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.promptButton,
            { backgroundColor: isDarkMode ? colors.card : "#f0f0f0" },
          ]}
          onPress={() => handlePromptClick(`How much did I make last month?${systemText}?`)}
          disabled={isLoading}
        >
          <Text style={[styles.promptButtonText, { color: colors.text }]}>
            How much did I make last month?
          </Text>
        </TouchableOpacity>
        
        {/* Chart-specific prompts */}
        <TouchableOpacity
          style={[
            styles.promptButton,
            { backgroundColor: isDarkMode ? colors.card : "#f0f0f0" },
          ]}
          onPress={() => handlePromptClick(`Show me energy production for 2024${systemText}`)}
          disabled={isLoading}
        >
          <Text style={[styles.promptButtonText, { color: colors.text }]}>
            📊 Show me energy production for 2024
          </Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[
            styles.promptButton,
            { backgroundColor: isDarkMode ? colors.card : "#f0f0f0" },
          ]}
          onPress={() => handlePromptClick(`Display my CO2 savings this year${systemText}`)}
          disabled={isLoading}
        >
          <Text style={[styles.promptButtonText, { color: colors.text }]}>
            🌱 Display my CO2 savings this year
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView 
      style={[
        styles.innerContainer,
        { backgroundColor: isDarkMode ? colors.background : "#fff" }
      ]}
      edges={['top', 'left', 'right']}
    >
      {/* System Selector - Now outside KeyboardAvoidingView */}
      <SystemSelector 
        systems={systems}
        selectedSystemId={selectedSystemId}
        setSelectedSystemId={setSelectedSystemId}
        loadingSystems={loadingSystems}
        isDarkMode={isDarkMode}
        colors={colors}
        showSystemModal={showSystemModal}
        setShowSystemModal={setShowSystemModal}
      />
      
      {/* KeyboardAvoidingView now only wraps the chat content and input */}
      <KeyboardAvoidingView
        style={[styles.container, { flex: 1 }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
        keyboardVerticalOffset={0}
      >
        {/* Messages or Initial Prompts */}
        <View style={styles.contentContainer}>
          {messages.length === 0 ? (
            <ScrollView contentContainerStyle={styles.initialPromptsScrollContainer}>
              {renderInitialPrompts()}
            </ScrollView>
          ) : (
            <FlatList
              ref={flatListRef}
              data={messages}
              renderItem={renderMessage}
              keyExtractor={(_, index) => index.toString()}
              contentContainerStyle={styles.messagesContainer}
              onContentSizeChange={() => {
                flatListRef.current?.scrollToEnd({ animated: false });
              }}
              keyboardShouldPersistTaps="handled"
            />
          )}
          
          {/* Loading indicator - positioned below messages */}
          {isLoading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
              <View style={styles.loadingTextContainer}>
                <Text style={[styles.loadingText, { color: colors.text }]}>
                  Thinking
                </Text>
                <Text style={[styles.loadingDots, { color: colors.text }]}>
                  {".".repeat(dotCount)}
                </Text>
              </View>
            </View>
          )}
        </View>
        
        {/* Input Bar - Always at the bottom, moves with keyboard */}
        <View 
          style={[
            styles.inputContainer,
            {
              backgroundColor: isDarkMode ? colors.card : "#f9f9f9",
              borderTopColor: isDarkMode ? colors.border : "#e0e0e0",
              // Add dynamic marginBottom for Android
              ...(Platform.OS === 'android' && { marginBottom: androidKeyboardHeight })
            }
          ]}
        >
          <TextInput
            ref={inputRef}
            style={[
              styles.input,
              {
                backgroundColor: isDarkMode ? colors.background : "#fff",
                color: colors.text,
                borderColor: isDarkMode ? colors.border : "#e0e0e0",
              },
            ]}
            value={input}
            onChangeText={setInput}
            placeholder="Type a message..."
            placeholderTextColor={isDarkMode ? "#888" : "#aaa"}
            multiline
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              {
                backgroundColor: input.trim()
                  ? colors.primary
                  : isDarkMode
                  ? "#444"
                  : "#e0e0e0",
                opacity: isLoading ? 0.5 : 1,
              },
            ]}
            onPress={() => handleSend()}
            disabled={isLoading || !input.trim()}
          >
            <Ionicons
              name="send"
              size={20}
              color={input.trim() ? "#fff" : isDarkMode ? "#aaa" : "#999"}
            />
          </TouchableOpacity>
        </View>
        
        {/* Bottom spacer to account for tab bar - only show when keyboard is hidden */}
        {!keyboardVisible && (() => {
          console.log(`Bottom spacer rendering - tabBarHeight: ${tabBarHeight}`);
          return <View style={{ height: tabBarHeight }} />;
        })()}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Completely revised styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  innerContainer: {
    flex: 1,
  },
  contentContainer: {
    flex: 1,
    position: 'relative',
  },
  messagesContainer: {
    padding: 16,
    paddingTop: 10,
    paddingBottom: 20,
  },
  initialPromptsScrollContainer: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  messageBubble: {
    padding: 12,
    borderRadius: 18,
    marginBottom: 8,
    maxWidth: "80%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  userBubble: {
    alignSelf: "flex-end",
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    alignSelf: "flex-start",
    borderBottomLeftRadius: 4,
  },
  messageRoleText: {
    fontWeight: "bold",
    marginBottom: 4,
    fontSize: 13,
  },
  messageContentText: {
    fontSize: 16,
    lineHeight: 22,
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 10,
    backgroundColor: "rgba(0,0,0,0.03)",
    borderRadius: 8,
    marginHorizontal: 10,
    marginBottom: 10,
  },
  loadingTextContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  loadingText: {
    marginLeft: 10,
    fontSize: 14,
  },
  loadingDots: {
    fontSize: 14,
    width: 20, // Fixed width to prevent shifting
    textAlign: 'left',
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    ...Platform.select({
      android: {
        position: 'relative', // Relative positioning for Android
      }
    })
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 100,
  },
  sendButton: {
    marginLeft: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  initialPromptsContainer: {
    flex: 1,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  robotIconPlaceholder: {
    marginBottom: 20,
  },
  initialTitle: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 8,
  },
  initialSubtitle: {
    fontSize: 16,
    marginBottom: 30,
    textAlign: "center",
  },
  promptButton: {
    width: "100%",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    alignItems: "flex-start",
  },
  promptButtonText: {
    fontSize: 16,
  },
  systemSelectorContainer: {
    padding: 10,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 5,
    borderRadius: 8,
  },
  systemSelectorLabel: {
    fontSize: 14,
    fontWeight: "bold",
    marginBottom: 8,
  },
  pickerContainer: {
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 5,
    ...Platform.select({
      android: {
        marginBottom: 10,
        elevation: 2,
        height: 55, // Increased height even more
        paddingTop: 2,
      }
    })
  },
  picker: {
    height: 45,
    width: '100%',
    ...Platform.select({
      android: {
        height: 60, // Explicitly set height for Android picker
        paddingHorizontal: 10,
        paddingVertical: 8,
      }
    })
  },
  dropdownButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  dropdownButtonText: {
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlayTouch: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  modalContent: {
    width: '80%',
    maxHeight: '70%',
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  modalItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderRadius: 8,
    marginVertical: 4,
    width: '100%',
  },
  modalItemText: {
    fontSize: 16,
  },
  closeButton: {
    marginTop: 15,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  chartContainer: {
    marginTop: 8,
    marginBottom: 8,
    marginHorizontal: 0, // Small horizontal margin for padding from screen edges
  },
}); 
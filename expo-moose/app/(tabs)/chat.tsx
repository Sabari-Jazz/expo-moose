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
} from "react-native";
import axios from "axios";
import Markdown from "react-native-markdown-display"; // Import the markdown display library
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import { Ionicons } from "@expo/vector-icons";
import KeyboardAwareView from "@/components/KeyboardAwareView";
import { getJwtToken } from "@/api/api";
import { getCurrentUser} from "@/utils/auth";
import { User } from "@/utils/auth";
import { getAccessibleSystems } from "@/utils/auth";
import * as api from "@/api/api";
import { Picker } from '@react-native-picker/picker';

// --- API Configuration ---
const API_URL = "http://10.0.0.210:8000/chat"; // Local backend API endpoint

// --- API Call Function ---
interface ChatRequest {
  message: string;
  username?: string;
  system_id?: string | null;
  jwtToken?: string;
}

interface ChatResponse {
  response: string;
  source_documents?: SourceDocument[];
}

interface SourceDocument {
  content: string;
  metadata?: any;
}

const getChatResponse = async (message: string, username: string, systemId: string | null): Promise<string> => {
  try {
    const requestData = {
      message: message,
      username: username,
      system_id: systemId,
      jwtToken: await getJwtToken(),
    } as ChatRequest;
    
    console.log("Sending API request with data:", JSON.stringify(requestData, null, 2));
    
    const response = await axios.post<ChatResponse>(API_URL, requestData);
    
    console.log("Received response from API:", response.data);
    if (response.data && response.data.response) {
      return response.data.response;
    } else {
      console.error("Unexpected API response structure:", response.data);
      throw new Error("Received unexpected data structure from API");
    }
  } catch (error: unknown) {
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

// --- Loading Messages ---
const LOADING_MESSAGES = [
  "Formulating answer...",
  "Consulting knowledge base...",
  "Checking sources...",
  "Running calculations...",
  "Compiling response...",
];

// --- The Chat Screen Component ---
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// System interface for selection
interface PvSystem {
  id: string;
  name: string;
}

export default function ChatScreen() {
  const { isDarkMode, colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const loadingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const inputRef = useRef<TextInput>(null);
  const userId = useRef(`user_${Math.random().toString(36).substring(2, 9)}`);
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
          const systemIds = getAccessibleSystems(currentUser.id);
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

  // Keyboard listeners
  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener(
      "keyboardDidShow",
      () => {
        setKeyboardVisible(true);
        if (flatListRef.current && messages.length > 0) {
          flatListRef.current.scrollToEnd({ animated: true });
        }
      }
    );
    const keyboardDidHideListener = Keyboard.addListener(
      "keyboardDidHide",
      () => {
        setKeyboardVisible(false);
      }
    );

    return () => {
      keyboardDidShowListener.remove();
      keyboardDidHideListener.remove();
    };
  }, [messages.length]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (flatListRef.current && messages.length > 0) {
      flatListRef.current.scrollToEnd({ animated: true });
    }
  }, [messages]);

  // Effect to handle loading message updates
  useEffect(() => {
    if (isLoading) {
      // Pick an initial message immediately
      setLoadingMessage(
        LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]
      );
      // Start interval to change message periodically
      loadingIntervalRef.current = setInterval(() => {
        setLoadingMessage((prevMessage) => {
          let newMessage;
          do {
            newMessage =
              LOADING_MESSAGES[
                Math.floor(Math.random() * LOADING_MESSAGES.length)
              ];
          } while (newMessage === prevMessage); // Avoid showing the same message twice in a row
          return newMessage;
        });
      }, 2500); // Change message every 2.5 seconds
    } else {
      // Clear interval and message when not loading
      if (loadingIntervalRef.current) {
        clearInterval(loadingIntervalRef.current);
        loadingIntervalRef.current = null;
      }
      setLoadingMessage("");
    }

    // Cleanup function to clear interval when component unmounts or isLoading changes
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

    const userMessage: ChatMessage = { role: "user", content: contentToSend };

    setMessages((prevMessages) => [...prevMessages, userMessage]);
    if (!messageToSend) {
      // Only clear input if it wasn't a prompt click
      setInput("");
    }
    setIsLoading(true); // Show loading indicator and trigger loading message effect

    try {
      // Pass the selected system ID to the API if one is selected
      const responseMessage = await getChatResponse(
        contentToSend, 
        user?.name || 'default_user',
        selectedSystemId
      );
      
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: responseMessage,
      };
      setMessages((prevMessages) => [...prevMessages, assistantMessage]);
    } catch (error) {
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
        // Use Markdown component for assistant messages
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
      ) : (
        // Use standard Text for user messages
        <Text style={[styles.messageContentText, { color: "#fff" }]}>
          {item.content}
        </Text>
      )}
    </View>
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
          onPress={() => handlePromptClick(`Tell me about STATE 102 error code${systemText}`)}
          disabled={isLoading}
        >
          <Text style={[styles.promptButtonText, { color: colors.text }]}>
            Tell me about STATE 102 error code
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.promptButton,
            { backgroundColor: isDarkMode ? colors.card : "#f0f0f0" },
          ]}
          onPress={() => handlePromptClick(`How do I clean my solar panels${systemText}?`)}
          disabled={isLoading}
        >
          <Text style={[styles.promptButtonText, { color: colors.text }]}>
            How do I clean my solar panels?
          </Text>
        </TouchableOpacity>
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
          onPress={() => handlePromptClick(`How often should I maintain my system${systemText}?`)}
          disabled={isLoading}
        >
          <Text style={[styles.promptButtonText, { color: colors.text }]}>
            How often should I maintain my system?
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  // Render the system selector
  const renderSystemSelector = () => {
    console.log("Rendering system selector with systems:", systems);
    console.log("Loading systems state:", loadingSystems);
    console.log("Selected system ID:", selectedSystemId);
    
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
      console.log("No systems available to show in selector");
      return (
        <View style={styles.systemSelectorContainer}>
          <Text style={[styles.systemSelectorLabel, { color: colors.text }]}>
            No systems available
          </Text>
        </View>
      );
    }

    const currentSystem = systems.find(s => s.id === selectedSystemId);
    const currentSystemName = currentSystem ? currentSystem.name : "Select system";

    return (
      <View style={styles.systemSelectorContainer}>
        <Text style={[styles.systemSelectorLabel, { color: colors.text }]}>
          Select a system:
        </Text>

        {/* Dropdown button - works on both iOS and Android */}
        <TouchableOpacity
          style={[
            styles.dropdownButton,
            { 
              backgroundColor: isDarkMode ? colors.card : '#f5f5f5',
              borderColor: colors.primary,
              borderWidth: 1,
            }
          ]}
          onPress={() => {
            // On iOS, show a modal with the system options
            if (Platform.OS === 'ios') {
              setShowSystemModal(true);
            }
            // On Android, this just draws focus to the native picker
          }}
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
        
        {/* System selection modal for iOS */}
        {Platform.OS === 'ios' && (
          <Modal
            visible={showSystemModal}
            transparent={true}
            animationType="slide"
            onRequestClose={() => setShowSystemModal(false)}
          >
            <TouchableOpacity
              style={styles.modalOverlay}
              activeOpacity={1}
              onPress={() => setShowSystemModal(false)}
            >
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
            </TouchableOpacity>
          </Modal>
        )}
        
        {/* Android native Picker */}
        {Platform.OS !== 'ios' && (
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
                  console.log("System selected:", value);
                  setSelectedSystemId(value);
                }
              }}
              style={[styles.picker, { color: colors.text }]}
              dropdownIconColor={colors.primary}
            >
              {systems.map(system => (
                <Picker.Item 
                  key={system.id} 
                  label={system.name} 
                  value={system.id} 
                />
              ))}
            </Picker>
          </View>
        )}
      </View>
    );
  };

  return (
    <KeyboardAwareView
      style={[
        styles.container,
        { backgroundColor: isDarkMode ? colors.background : "#fff" },
      ]}
      contentContainerStyle={{
        paddingTop: insets.top,
      }}
      bottomTabBarHeight={Platform.OS === "android" ? 90 : 80}
      extraScrollHeight={120}
      dismissKeyboardOnTouch={false}
    >
      {/* System Selector */}
      {renderSystemSelector()}
      
      {messages.length === 0 ? (
        // Show initial prompts when no messages
        renderInitialPrompts()
      ) : (
        // Show chat messages
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(_, index) => index.toString()}
          contentContainerStyle={[
            styles.messagesContainer,
            { paddingBottom: keyboardVisible ? 120 : 120 },
          ]}
        />
      )}

      {/* Loading indicator */}
      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.text }]}>
            {loadingMessage}
          </Text>
        </View>
      )}

      {/* Input area */}
      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: isDarkMode ? colors.card : "#f9f9f9",
            borderTopColor: isDarkMode ? colors.border : "#e0e0e0",
            paddingBottom: Math.max(
              insets.bottom + (Platform.OS === "ios" ? 25 : 15),
              20
            ),
          },
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
    </KeyboardAwareView>
  );
}

// --- Styles ---
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  messagesContainer: {
    flexGrow: 1,
    padding: 16,
    paddingTop: 10,
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
    margin: 10,
  },
  loadingText: {
    marginLeft: 10,
    fontSize: 14,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
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
  },
  picker: {
    height: 45,
    width: '100%',
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
}); 
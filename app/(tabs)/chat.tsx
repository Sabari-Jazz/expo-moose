// import React, { useState, useRef, useEffect } from "react";
// import {
//   StyleSheet,
//   View,
//   Text,
//   TextInput,
//   Button,
//   FlatList,
//   Platform,
//   ActivityIndicator,
//   SafeAreaView,
//   TouchableOpacity,
//   Keyboard,
//   Alert,
// } from "react-native";
// import axios from "axios";
// import Markdown from "react-native-markdown-display";
// import { Image } from "expo-image";
// import { useSafeAreaInsets } from "react-native-safe-area-context";
// import { useTheme } from "@/hooks/useTheme";
// import { Ionicons } from "@expo/vector-icons";
// import KeyboardAwareView from "@/components/KeyboardAwareView";
// import { getCurrentUser, AUTH_TOKEN_KEY } from "@/utils/auth";
// import AsyncStorage from "@react-native-async-storage/async-storage";
// import { router } from "expo-router";

// // Helper function to get value from AsyncStorage
// const getValueFor = async (key: string): Promise<string | null> => {
//   try {
//     return await AsyncStorage.getItem(key);
//   } catch (error) {
//     console.error("Error retrieving value:", error);
//     return null;
//   }
// };

// // --- API Configuration ---
// const API_URL = "http://172.17.161.41:8000/api/chat"; //need to change this, TODOO

// // --- API Call Function ---
// interface ChatRequest {
//   system_id: string;
//   message: string;
//   conversation_history: ChatMessage[];
//   conversation_id?: string;
//   user_email?: string;
// }

// interface ChatResponse {
//   status: string;
//   message: string;
//   conversation_id?: string;
// }

// // --- The Chat Screen Component ---
// interface ChatMessage {
//   role: "user" | "assistant";
//   content: string;
//   timestamp?: string;
// }

// // Add a system interface for selection
// interface PvSystem {
//   id: string;
//   name: string;
//   address?: string;
// }

// const getChatResponse = async (
//   request: ChatRequest,
//   authToken: string
// ): Promise<string> => {
//   try {
//     console.log("Sending message to API:", request);

//     // Validate token before making request
//     if (!authToken || authToken.trim() === "") {
//       throw new Error("Authentication token is missing or invalid");
//     }

//     const response = await axios.post<ChatResponse>(API_URL, request, {
//       headers: {
//         "Content-Type": "application/json",
//         Authorization: `Bearer ${authToken}`,
//       },
//       timeout: 30000,
//     });

//     console.log("Received response from API:", response.data);
//     if (response.data && response.data.message) {
//       return response.data.message;
//     } else {
//       console.error("Unexpected API response structure:", response.data);
//       throw new Error("Received unexpected data structure from API");
//     }
//   } catch (error: unknown) {
//     if (axios.isAxiosError(error)) {
//       if (error.response) {
//         console.error("API Error Response Data:", error.response.data);
//         console.error("API Error Response Status:", error.response.status);
//         console.error("API Error Response Headers:", error.response.headers);

//         // Handle specific error cases
//         if (error.response.status === 401) {
//           // Clear the token from storage on auth errors
//           AsyncStorage.removeItem(AUTH_TOKEN_KEY);
//           throw new Error("Authentication error. Please log in again.");
//         } else if (error.response.status === 403) {
//           throw new Error("You don't have access to this solar system.");
//         } else if (error.response.status >= 500) {
//           throw new Error("Server error. Please try again later.");
//         }
//       } else if (error.request) {
//         console.error("API Error Request:", error.request);
//         throw new Error(
//           "Network error. Please check your connection and try again."
//         );
//       }
//     } else {
//       console.error("API Error Message:", (error as Error).message);
//     }
//     console.error("Error communicating with API:", error);
//     throw error instanceof Error
//       ? error
//       : new Error("Failed to fetch response from the chat service.");
//   }
// };

// // --- Loading Messages ---
// const LOADING_MESSAGES = [
//   "Formulating answer...",
//   "Consulting knowledge base...",
//   "Checking sources...",
//   "Running calculations...",
//   "Compiling response...",
// ];

// // --- API Status Check ---
// const checkApiStatus = async () => {
//   try {
//     console.log("Checking API status...");

//     // First check if we have a valid auth token
//     const authToken = await getValueFor(AUTH_TOKEN_KEY);
//     if (!authToken) {
//       console.warn("No authentication token found during API status check");
//       //  try to connect to check if server is up
//     }

//     // Test the root endpoint
//     const response = await axios.get("http://172.17.161.41:8000/", {
//       timeout: 5000, // Short timeout for status check
//     });

//     console.log("API Status Response:", response.data);

//     // optional, verify the token if we have one
//     if (authToken) {
//       try {
//         await axios.get("http://172.17.161.41:8000/api/user/systems", {
//           headers: {
//             Authorization: `Bearer ${authToken}`,
//           },
//           timeout: 5000,
//         });
//         console.log("Auth token is valid");
//       } catch (authError) {
//         if (
//           axios.isAxiosError(authError) &&
//           authError.response?.status === 401
//         ) {
//           console.warn("Auth token is invalid or expired");
//           // Clear the invalid token
//           await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
//           return { serverUp: true, authValid: false };
//         }
//       }
//     }

//     return { serverUp: true, authValid: !!authToken };
//   } catch (error) {
//     console.error("API Status Check Error:", error);
//     return { serverUp: false, authValid: false };
//   }
// };

// export default function ChatScreen() {
//   const { isDarkMode, colors } = useTheme();
//   const insets = useSafeAreaInsets();
//   const [messages, setMessages] = useState<ChatMessage[]>([]);
//   const [input, setInput] = useState("");
//   const [isLoading, setIsLoading] = useState(false);
//   const [loadingMessage, setLoadingMessage] = useState("");
//   const [keyboardVisible, setKeyboardVisible] = useState(false);
//   const flatListRef = useRef<FlatList>(null);
//   const loadingIntervalRef = useRef<NodeJS.Timeout | null>(null);
//   const inputRef = useRef<TextInput>(null);
//   const [userInfo, setUserInfo] = useState<any>(null);
//   const [selectedSystemId, setSelectedSystemId] = useState<string>("");
//   const [initialGreetingSent, setInitialGreetingSent] = useState(false);
//   const [availableSystems, setAvailableSystems] = useState<PvSystem[]>([]);
//   const [systemSelectionNeeded, setSystemSelectionNeeded] = useState(false);

//   // Get user info and load systems
//   useEffect(() => {
//     const loadUserData = async () => {
//       try {
//         // Check API connection first
//         const apiStatus = await checkApiStatus();

//         if (!apiStatus.serverUp) {
//           Alert.alert(
//             "Server Connection Error",
//             "Cannot connect to the server. Please make sure the server is running and accessible.",
//             [{ text: "OK" }]
//           );
//           return;
//         }

//         if (!apiStatus.authValid) {
//           Alert.alert(
//             "Authentication Error",
//             "Your session has expired or you are not logged in. Please log in again.",
//             [
//               {
//                 text: "Go to Login",
//                 onPress: () => {
//                   router.replace("/");
//                 },
//               },
//               {
//                 text: "Cancel",
//                 style: "cancel",
//               },
//             ]
//           );
//           return;
//         }

//         const user = await getCurrentUser();
//         if (user) {
//           setUserInfo(user);
//           await loadUserSystems(user);
//         } else {
//           Alert.alert("Error", "User not authenticated. Please login.");
//         }
//       } catch (error) {
//         console.error("Error loading user data:", error);
//       }
//     };

//     loadUserData();
//   }, []);

//   // Load user systems from API
//   const loadUserSystems = async (user: any) => {
//     try {
//       // For demo purposes, use hardcoded data - in a real app, fetch from API
//       const demoSystems: PvSystem[] = [
//         {
//           id: "bf915090-5f59-4128-a206-46c73f2f779d",
//           name: "Home Solar System",
//         },
//         {
//           id: "f2fafda2-9b07-40e3-875f-db6409040b9c",
//           name: "Office Solar System",
//         },
//         { id: "3fa4cdb6-8761-4391-b2e8-e4cd092c1955", name: "Warehouse Solar" },
//       ];


//       setAvailableSystems(demoSystems);

//       if (demoSystems.length === 1) {
//         setSelectedSystemId(demoSystems[0].id);
//       } else if (demoSystems.length > 1) {

//         setSystemSelectionNeeded(true);
//       }
//     } catch (error) {
//       console.error("Error loading user systems:", error);
//     }
//   };


//   useEffect(() => {
//     const sendInitialGreeting = async () => {
//       if (userInfo && !initialGreetingSent && messages.length === 0) {
//         try {

//           const greetingResponse = `Hi ${
//             userInfo.name || "there"
//           }! 👋 I'm your Moose solar assistant. How can I help you today with your solar system?`;

//           const assistantMessage: ChatMessage = {
//             role: "assistant",
//             content: greetingResponse,
//           };

//           setMessages([assistantMessage]);
//           setInitialGreetingSent(true);
//         } catch (error) {
//           console.error("Error sending initial greeting:", error);
//         }
//       }
//     };

//     sendInitialGreeting();
//   }, [userInfo, initialGreetingSent, messages.length]);

//   // Keyboard listeners
//   useEffect(() => {
//     const keyboardDidShowListener = Keyboard.addListener(
//       "keyboardDidShow",
//       () => {
//         setKeyboardVisible(true);
//         if (flatListRef.current && messages.length > 0) {
//           flatListRef.current.scrollToEnd({ animated: true });
//         }
//       }
//     );
//     const keyboardDidHideListener = Keyboard.addListener(
//       "keyboardDidHide",
//       () => {
//         setKeyboardVisible(false);
//       }
//     );

//     return () => {
//       keyboardDidShowListener.remove();
//       keyboardDidHideListener.remove();
//     };
//   }, [messages.length]);

//   useEffect(() => {
//     if (flatListRef.current && messages.length > 0) {
//       flatListRef.current.scrollToEnd({ animated: true });
//     }
//   }, [messages]);

//   useEffect(() => {
//     if (isLoading) {
//       setLoadingMessage(
//         LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)]
//       );
//       loadingIntervalRef.current = setInterval(() => {
//         setLoadingMessage((prevMessage) => {
//           let newMessage;
//           do {
//             newMessage =
//               LOADING_MESSAGES[
//                 Math.floor(Math.random() * LOADING_MESSAGES.length)
//               ];
//           } while (newMessage === prevMessage);
//           return newMessage;
//         });
//       }, 2500);
//     } else {
//       if (loadingIntervalRef.current) {
//         clearInterval(loadingIntervalRef.current);
//         loadingIntervalRef.current = null;
//       }
//       setLoadingMessage("");
//     }

//     // Cleanup function to clear interval when component unmounts or isLoading changes
//     return () => {
//       if (loadingIntervalRef.current) {
//         clearInterval(loadingIntervalRef.current);
//         loadingIntervalRef.current = null;
//       }
//     };
//   }, [isLoading]);

//   // Handle user messages and determine if system selection is needed
//   const handleUserMessage = (content: string) => {
//     const lowerContent = content.toLowerCase();

//     // Check if user is asking about power production or system status
//     const isPowerQuestion =
//       lowerContent.includes("power") ||
//       lowerContent.includes("energy") ||
//       lowerContent.includes("production") ||
//       lowerContent.includes("producing") ||
//       lowerContent.includes("status");

//     // Check if user is requesting a report
//     const isReportRequest =
//       lowerContent.includes("report") ||
//       lowerContent.includes("email") ||
//       lowerContent.includes("send me");

//     if (
//       (isPowerQuestion || isReportRequest) &&
//       !selectedSystemId &&
//       availableSystems.length > 0
//     ) {
//       if (availableSystems.length === 1) {
//         // If only one system, auto-select it
//         setSelectedSystemId(availableSystems[0].id);
//         return false; // No selection prompt needed
//       } else {
//         // If multiple systems, prompt for selection
//         const systemOptions = availableSystems
//           .map((system) => `- ${system.name} (${system.id.substring(0, 8)}...)`)
//           .join("\n");

//         setTimeout(() => {
//           const assistantMessage: ChatMessage = {
//             role: "assistant",
//             content: `Which solar system would you like information about? Please choose one:\n\n${systemOptions}\n\nYou can respond with the name or ID of the system.`,
//           };
//           setMessages((prev) => [...prev, assistantMessage]);
//           setSystemSelectionNeeded(true);
//         }, 500);
//         return true; // Selection prompt needed
//       }
//     }

//     return false; // No selection prompt needed
//   };

//   // Handle system selection from user response
//   const handleSystemSelection = (userInput: string) => {
//     const lowerInput = userInput.toLowerCase();

//     // Check if input matches any system name or id
//     const matchedSystem = availableSystems.find(
//       (system) =>
//         system.name.toLowerCase().includes(lowerInput) ||
//         system.id.toLowerCase().includes(lowerInput)
//     );

//     if (matchedSystem) {
//       setSelectedSystemId(matchedSystem.id);
//       setTimeout(() => {
//         const assistantMessage: ChatMessage = {
//           role: "assistant",
//           content: `I've selected the system "${matchedSystem.name}". What would you like to know about it?`,
//         };
//         setMessages((prev) => [...prev, assistantMessage]);
//         setSystemSelectionNeeded(false);
//       }, 500);
//       return true;
//     }

//     // If multiple potential matches
//     const potentialMatches = availableSystems.filter((system) =>
//       system.name.toLowerCase().includes(lowerInput)
//     );

//     if (potentialMatches.length > 1) {
//       setTimeout(() => {
//         const options = potentialMatches
//           .map((system) => `- ${system.name} (${system.id.substring(0, 8)}...)`)
//           .join("\n");

//         const assistantMessage: ChatMessage = {
//           role: "assistant",
//           content: `I found multiple systems that match "${userInput}". Which one did you mean?\n\n${options}`,
//         };
//         setMessages((prev) => [...prev, assistantMessage]);
//       }, 500);
//       return true;
//     }

//     return false;
//   };

//   // --- Handle Sending a Message ---
//   const handleSend = async (messageToSend?: string) => {
//     const contentToSend = messageToSend ?? input.trim();

//     if (!contentToSend) {
//       console.log("Attempting to send empty message.");
//       return;
//     }

//     const userMessage: ChatMessage = { role: "user", content: contentToSend };
//     setMessages((prevMessages) => [...prevMessages, userMessage]);

//     if (!messageToSend) {
//       setInput("");
//     }

//     // If system selection is needed, try to handle it
//     if (systemSelectionNeeded) {
//       const handled = handleSystemSelection(contentToSend);
//       if (handled) return;
//     }

//     // If user is asking about power but no system selected
//     if (!selectedSystemId) {
//       const selectionNeeded = handleUserMessage(contentToSend);
//       if (selectionNeeded) return;
//     }

//     // If we got here, proceed with API call
//     setIsLoading(true);

//     try {
//       // Get token for authentication
//       const authToken = await getValueFor(AUTH_TOKEN_KEY);
//       if (!authToken) {
//         handleAuthError("Authentication token not found. Please log in again.");
//         return;
//       }

//       // If asking about a report, extract email if provided
//       let userEmail: string | undefined = undefined;
//       if (
//         contentToSend.toLowerCase().includes("report") &&
//         contentToSend.toLowerCase().includes("email")
//       ) {
//         // Simple regex to extract email
//         const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
//         const emailMatch = contentToSend.match(emailRegex);
//         if (emailMatch) {
//           userEmail = emailMatch[0];
//         }
//       }

//       // Prepare conversation history in the format expected by the API
//       const conversationHistory = messages.slice(-10);

//       // Create the chat request
//       const chatRequest: ChatRequest = {
//         system_id: selectedSystemId || "default", // Use default if no system selected
//         message: contentToSend,
//         conversation_history: conversationHistory,
//         conversation_id: "chat_" + Date.now(),
//         user_email: userEmail,
//       };

//       // Call the API
//       const gptMessageContent = await getChatResponse(chatRequest, authToken);

//       const assistantMessage: ChatMessage = {
//         role: "assistant",
//         content: gptMessageContent,
//       };
//       setMessages((prevMessages) => [...prevMessages, assistantMessage]);
//     } catch (error) {
//       console.error("Error in handleSend:", error);

//       if (
//         error instanceof Error &&
//         error.message.includes("Authentication error")
//       ) {
//         handleAuthError(error.message);
//       } else {
//         // If no system is selected yet, ask the user which system
//         if (!selectedSystemId && availableSystems.length > 0) {
//           handleUserMessage(contentToSend);
//         } else {
//           const errorMessage: ChatMessage = {
//             role: "assistant",
//             content: `Sorry, I encountered an error. Please try again.\n*Details: ${
//               (error as Error).message
//             }*`,
//           };
//           setMessages((prevMessages) => [...prevMessages, errorMessage]);
//         }
//       }
//     } finally {
//       setIsLoading(false);
//     }
//   };

//   // Handle authentication errors
//   const handleAuthError = (errorMessage: string) => {
//     // Clear any existing token
//     AsyncStorage.removeItem(AUTH_TOKEN_KEY);

//     // Show alert with option to go to login
//     Alert.alert("Authentication Error", errorMessage, [
//       {
//         text: "Go to Login",
//         onPress: () => {
//           router.replace("/");
//         },
//       },
//       {
//         text: "OK",
//         style: "cancel",
//       },
//     ]);

//     // Add an error message to the chat
//     const errorChatMessage: ChatMessage = {
//       role: "assistant",
//       content:
//         "⚠️ Your session has expired. Please log in again to continue using the chat feature.",
//     };
//     setMessages((prevMessages) => [...prevMessages, errorChatMessage]);
//   };

//   // --- Render Each Message Item ---
//   const renderMessage = ({ item }: { item: ChatMessage }) => (
//     <View
//       style={[
//         styles.messageBubble,
//         item.role === "user"
//           ? [styles.userBubble, { backgroundColor: colors.primary }]
//           : [
//               styles.assistantBubble,
//               { backgroundColor: isDarkMode ? colors.card : "#f0f0f0" },
//             ],
//       ]}
//     >
//       <Text
//         style={[
//           styles.messageRoleText,
//           { color: item.role === "user" ? "#fff" : colors.text },
//         ]}
//       >
//         {item.role === "user" ? "You" : "Moose"}
//       </Text>
//       {item.role === "assistant" ? (
//         // Use simple Text for assistant messages to avoid nesting issues
//         <Text style={[styles.messageContentText, { color: colors.text }]}>
//           {item.content}
//         </Text>
//       ) : (
//         // Use standard Text for user messages
//         <Text style={[styles.messageContentText, { color: "#fff" }]}>
//           {item.content}
//         </Text>
//       )}
//     </View>
//   );

//   // --- Initial Prompt Buttons ---
//   const renderInitialPrompts = () => (
//     <View style={styles.initialPromptsContainer}>
//       <View style={styles.robotIconPlaceholder}>
//         <Image
//           source={require("@/assets/icon.png")}
//           style={{ width: 100, height: 70 }}
//         />
//       </View>
//       <Text style={[styles.initialTitle, { color: colors.text }]}>
//         Hello {userInfo?.name || "There"}!
//       </Text>
//       <Text style={[styles.initialSubtitle, { color: colors.text }]}>
//         How can I help with your solar system today?
//       </Text>

//       <View style={styles.promptsContainer}>
//         <TouchableOpacity
//           style={[
//             styles.promptButton,
//             { backgroundColor: isDarkMode ? "#333" : "#f0f0f0" },
//           ]}
//           onPress={() =>
//             handlePromptClick(
//               "How much power is my system producing right now?"
//             )
//           }
//         >
//           <Text style={{ color: colors.text }}>
//             How much power is my system producing?
//           </Text>
//         </TouchableOpacity>

//         <TouchableOpacity
//           style={[
//             styles.promptButton,
//             { backgroundColor: isDarkMode ? "#333" : "#f0f0f0" },
//           ]}
//           onPress={() =>
//             handlePromptClick("Send a monthly performance report to my email")
//           }
//         >
//           <Text style={{ color: colors.text }}>
//             Send a performance report to my email
//           </Text>
//         </TouchableOpacity>

//         <TouchableOpacity
//           style={[
//             styles.promptButton,
//             { backgroundColor: isDarkMode ? "#333" : "#f0f0f0" },
//           ]}
//           onPress={() =>
//             handlePromptClick("What's my system's status right now?")
//           }
//         >
//           <Text style={{ color: colors.text }}>What's my system's status?</Text>
//         </TouchableOpacity>

//         <TouchableOpacity
//           style={[
//             styles.promptButton,
//             { backgroundColor: isDarkMode ? "#333" : "#f0f0f0" },
//           ]}
//           onPress={() =>
//             handlePromptClick("How much energy did I produce today?")
//           }
//         >
//           <Text style={{ color: colors.text }}>
//             How much energy did I produce today?
//           </Text>
//         </TouchableOpacity>
//       </View>
//     </View>
//   );

//   const handlePromptClick = (promptText: string) => {
//     handleSend(promptText);
//   };

//   return (
//     <KeyboardAwareView style={styles.container}>
//       <SafeAreaView
//         style={[
//           styles.safeArea,
//           { backgroundColor: isDarkMode ? colors.background : "#f9f9f9" },
//         ]}
//       >
//         {/* Messages List */}
//         {messages.length > 0 ? (
//           <FlatList
//             ref={flatListRef}
//             data={messages}
//             keyExtractor={(item, index) => index.toString()}
//             renderItem={renderMessage}
//             contentContainerStyle={[
//               styles.messagesList,
//               { paddingBottom: keyboardVisible ? 80 : 20 },
//             ]}
//             onLayout={() => {
//               if (flatListRef.current && messages.length > 0) {
//                 flatListRef.current.scrollToEnd({ animated: false });
//               }
//             }}
//           />
//         ) : (
//           // Show initial prompts if no messages yet
//           renderInitialPrompts()
//         )}

//         {/* Loading Indicator */}
//         {isLoading && (
//           <View style={styles.loadingContainer}>
//             <View
//               style={[
//                 styles.loadingBubble,
//                 { backgroundColor: isDarkMode ? colors.card : "#f0f0f0" },
//               ]}
//             >
//               <View style={styles.loadingContent}>
//                 <ActivityIndicator
//                   size="small"
//                   color={colors.primary}
//                   style={styles.loadingSpinner}
//                 />
//                 <Text
//                   style={[styles.loadingText, { color: colors.text }]}
//                   numberOfLines={1}
//                 >
//                   {loadingMessage}
//                 </Text>
//               </View>
//             </View>
//           </View>
//         )}

//         {/* Input Area */}
//         <View
//           style={[
//             styles.inputContainer,
//             {
//               backgroundColor: isDarkMode ? colors.card : "#fff",
//               borderTopColor: isDarkMode ? "#333" : "#eee",
//             },
//           ]}
//         >
//           <TextInput
//             ref={inputRef}
//             style={[
//               styles.input,
//               {
//                 backgroundColor: isDarkMode ? "#1c1c1c" : "#f5f5f5",
//                 color: colors.text,
//               },
//             ]}
//             placeholder="Type a message..."
//             placeholderTextColor={isDarkMode ? "#777" : "#999"}
//             value={input}
//             onChangeText={setInput}
//             multiline
//           />
//           <TouchableOpacity
//             style={[
//               styles.sendButton,
//               { backgroundColor: input.trim() ? colors.primary : "#ccc" },
//             ]}
//             onPress={() => handleSend()}
//             disabled={!input.trim() || isLoading}
//           >
//             <Ionicons
//               name="send"
//               size={20}
//               color="#fff"
//               style={styles.sendIcon}
//             />
//           </TouchableOpacity>
//         </View>
//       </SafeAreaView>
//     </KeyboardAwareView>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//   },
//   safeArea: {
//     flex: 1,
//     paddingTop: 10,
//   },
//   messagesList: {
//     flexGrow: 1,
//     padding: 16,
//   },
//   messageBubble: {
//     padding: 12,
//     borderRadius: 12,
//     marginBottom: 10,
//     maxWidth: "80%",
//   },
//   userBubble: {
//     alignSelf: "flex-end",
//     backgroundColor: "#1c84ff",
//   },
//   assistantBubble: {
//     alignSelf: "flex-start",
//     backgroundColor: "#f0f0f0",
//   },
//   messageRoleText: {
//     fontWeight: "700",
//     marginBottom: 4,
//     fontSize: 12,
//   },
//   messageContentText: {
//     fontSize: 16,
//     lineHeight: 22,
//   },
//   inputContainer: {
//     flexDirection: "row",
//     padding: 10,
//     alignItems: "center",
//     borderTopWidth: 1,
//   },
//   input: {
//     flex: 1,
//     borderWidth: 1,
//     borderRadius: 20,
//     paddingHorizontal: 16,
//     paddingVertical: 10,
//     fontSize: 16,
//     borderColor: "transparent",
//   },
//   sendButton: {
//     borderRadius: 20,
//     width: 40,
//     height: 40,
//     justifyContent: "center",
//     alignItems: "center",
//     marginLeft: 8,
//   },
//   loadingContainer: {
//     position: "absolute",
//     bottom: 80,
//     left: 16,
//     right: 16,
//     alignItems: "flex-start",
//     margin: 10,
//   },
//   loadingBubble: {
//     padding: 10,
//     borderRadius: 10,
//     backgroundColor: "rgba(0,0,0,0.03)",
//   },
//   loadingContent: {
//     flexDirection: "row",
//     alignItems: "center",
//   },
//   loadingSpinner: {
//     marginRight: 10,
//   },
//   loadingText: {
//     fontSize: 14,
//   },
//   initialPromptsContainer: {
//     flex: 1,
//     justifyContent: "center",
//     alignItems: "center",
//     padding: 20,
//   },
//   robotIconPlaceholder: {
//     justifyContent: "center",
//     alignItems: "center",
//   },
//   initialTitle: {
//     fontSize: 24,
//     fontWeight: "bold",
//     marginBottom: 8,
//     marginTop: 30,
//     textAlign: "center",
//   },
//   initialSubtitle: {
//     fontSize: 16,
//     marginBottom: 30,
//     textAlign: "center",
//   },
//   promptsContainer: {
//     flexDirection: "row",
//     flexWrap: "wrap",
//     justifyContent: "space-between",
//     width: "100%",
//   },
//   promptButton: {
//     width: "48%",
//     borderRadius: 12,
//     paddingVertical: 16,
//     paddingHorizontal: 20,
//     marginBottom: 12,
//   },
//   sendIcon: {
//     marginLeft: 2,
//   },
// });

// // --- Markdown Styles ---
// const markdownStyles = (isDarkMode: boolean, colors: any) => ({
//   body: {
//     fontSize: 16,
//     lineHeight: 24,
//     color: colors.text,
//   },
//   heading1: {
//     fontSize: 24,
//     fontWeight: "bold",
//     marginTop: 12,
//     marginBottom: 8,
//     color: colors.text,
//   },
//   heading2: {
//     fontSize: 20,
//     fontWeight: "bold",
//     marginTop: 10,
//     marginBottom: 6,
//     color: colors.text,
//   },
//   paragraph: {
//     marginBottom: 8,
//     color: colors.text,
//   },
//   code_block: {
//     backgroundColor: isDarkMode ? "#333" : "#f5f5f5",
//     padding: 10,
//     borderRadius: 4,
//     fontFamily: "monospace",
//   },
//   code_inline: {
//     backgroundColor: isDarkMode ? "#333" : "#f5f5f5",
//     padding: 2,
//     borderRadius: 4,
//     fontFamily: "monospace",
//   },
//   blockquote: {
//     borderLeftWidth: 4,
//     borderLeftColor: "#ccc",
//     paddingLeft: 10,
//     fontStyle: "italic",
//   },
//   link: {
//     color: colors.primary,
//     textDecorationLine: "underline" as "underline",
//   },
// });



import React, { useState, useRef, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Button,
  FlatList,
  Platform,
  ActivityIndicator,
  SafeAreaView,
  TouchableOpacity,
  Keyboard,
} from "react-native";
import axios from "axios";
import Markdown from "react-native-markdown-display"; // Import the markdown display library
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import { Ionicons } from "@expo/vector-icons";
import KeyboardAwareView from "@/components/KeyboardAwareView";

// --- API Configuration ---
const API_URL = "https://chat.api.socialenergy.ca/chat";

// --- API Call Function ---
interface ChatRequest {
  message: string;
}

interface ChatResponse {
  message: string;
}

const getChatGPTResponse = async (message: string): Promise<string> => {
  try {
    console.log("Sending message to API:", message);
    const response = await axios.post<ChatResponse>(API_URL, {
      message: message,
    } as ChatRequest);
    console.log("Received response from API:", response.data);
    if (response.data && response.data.message) {
      return response.data.message;
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
  // "Consulting knowledge base...",
  // "Checking sources...",
  // "Running calculations...",
  // "Compiling response...",
];

// --- The Chat Screen Component ---
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
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
      const gptMessageContent = await getChatGPTResponse(contentToSend);
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: gptMessageContent,
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
        {item.role === "user" ? "You" : "Moose"}
      </Text>
      {item.role === "assistant" ? (
        // Use Markdown component for assistant messages
        <Markdown style={markdownStyles(isDarkMode, colors)}>
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

  // --- Initial Prompt Buttons ---
  const renderInitialPrompts = () => (
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
        Tell what is on your mind?
      </Text>

      <TouchableOpacity
        style={[
          styles.promptButton,
          { backgroundColor: isDarkMode ? colors.card : "#f0f0f0" },
        ]}
        onPress={() => handlePromptClick("Tell me about my Solar System.")}
        disabled={isLoading}
      >
        <Text style={[styles.promptButtonText, { color: colors.text }]}>
          Tell me about my Solar System.
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[
          styles.promptButton,
          { backgroundColor: isDarkMode ? colors.card : "#f0f0f0" },
        ]}
        onPress={() =>
          handlePromptClick("Tell me the status of the device at my home.")
        }
        disabled={isLoading}
      >
        <Text style={[styles.promptButtonText, { color: colors.text }]}>
          Tell me the status of the device at my home.
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[
          styles.promptButton,
          { backgroundColor: isDarkMode ? colors.card : "#f0f0f0" },
        ]}
        onPress={() =>
          handlePromptClick("What is the maintenance plan for my system?")
        }
        disabled={isLoading}
      >
        <Text style={[styles.promptButtonText, { color: colors.text }]}>
          What is the maintenance plan for my system?
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[
          styles.promptButton,
          { backgroundColor: isDarkMode ? colors.card : "#f0f0f0" },
        ]}
        onPress={() => handlePromptClick("What are my net zero plans.")}
        disabled={isLoading}
      >
        <Text style={[styles.promptButtonText, { color: colors.text }]}>
          What are my net zero plans?
        </Text>
      </TouchableOpacity>
    </View>
  );

  // --- Handle Clicking Initial Prompts ---
  const handlePromptClick = (promptText: string) => {
    if (isLoading) return; // Prevent multiple submissions
    handleSend(promptText); // Call handleSend directly with the prompt text
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
          maxHeight={100}
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
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  promptButtonText: {
    fontSize: 16,
    fontWeight: "500",
  },
});

// --- Markdown Styles ---
const markdownStyles = (isDarkMode: boolean, colors: any) => ({
  body: {
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
  },
  heading1: {
    fontSize: 20,
    fontWeight: "bold",
    marginTop: 10,
    marginBottom: 5,
    color: colors.text,
  },
  heading2: {
    fontSize: 18,
    fontWeight: "bold",
    marginTop: 10,
    marginBottom: 5,
    color: colors.text,
  },
  heading3: {
    fontSize: 16,
    fontWeight: "bold",
    marginTop: 8,
    marginBottom: 4,
    color: colors.text,
  },
  code_block: {
    backgroundColor: isDarkMode ? "#333" : "#f5f5f5",
    padding: 12,
    borderRadius: 6,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 14,
    color: isDarkMode ? "#e0e0e0" : "#333",
  },
  code_inline: {
    backgroundColor: isDarkMode ? "#333" : "#f5f5f5",
    padding: 4,
    borderRadius: 4,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 14,
    color: isDarkMode ? "#e0e0e0" : "#333",
  },
  link: {
    color: colors.primary,
    textDecorationLine: "underline",
  },
  blockquote: {
    borderLeftWidth: 4,
    borderLeftColor: isDarkMode ? "#666" : "#ddd",
    paddingLeft: 12,
    paddingVertical: 4,
    marginVertical: 8,
    fontStyle: "italic",
  },
});

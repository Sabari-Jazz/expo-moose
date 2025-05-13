import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { useThemeColor } from "@/hooks/useThemeColor";
import {
  FeedbackItem,
  getAllFeedback,
  deleteFeedback,
  updateFeedbackStatus,
} from "@/services/feedbackService";
import { Stack } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";

export default function FeedbackAdminScreen() {
  const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const primaryColor = useThemeColor({}, "tint");
  const secondaryColor = useThemeColor({}, "tabIconDefault");
  const backgroundColor = useThemeColor({}, "background");
  const cardColor = useThemeColor({}, "cardBackground");
  const textColor = useThemeColor({}, "text");

  // Load feedback items
  const loadFeedback = async () => {
    try {
      setLoading(true);
      const items = await getAllFeedback();
      setFeedbackItems(items);
    } catch (error) {
      console.error("Error loading feedback:", error);
      Alert.alert("Error", "Could not load feedback items");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Handle refresh
  const handleRefresh = () => {
    setRefreshing(true);
    loadFeedback();
  };

  // Handle delete
  const handleDelete = (ticketId: string) => {
    Alert.alert(
      "Delete Feedback",
      "Are you sure you want to delete this feedback item?",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteFeedback(ticketId);
              setFeedbackItems(
                feedbackItems.filter((item) => item.ticketId !== ticketId)
              );
            } catch (error) {
              console.error("Error deleting feedback:", error);
              Alert.alert("Error", "Failed to delete feedback");
            }
          },
        },
      ]
    );
  };

  // Toggle status
  const toggleStatus = async (
    ticketId: string,
    currentStatus: "pending" | "resolved"
  ) => {
    try {
      const newStatus = currentStatus === "pending" ? "resolved" : "pending";
      const success = await updateFeedbackStatus(ticketId, newStatus);

      if (success) {
        setFeedbackItems(
          feedbackItems.map((item) =>
            item.ticketId === ticketId ? { ...item, status: newStatus } : item
          )
        );
      } else {
        Alert.alert("Error", "Failed to update status");
      }
    } catch (error) {
      console.error("Error updating status:", error);
      Alert.alert("Error", "Failed to update status");
    }
  };

  // Format date
  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  // Load feedback on mount
  useEffect(() => {
    loadFeedback();
  }, []);

  // Render feedback item
  const renderFeedbackItem = ({ item }: { item: FeedbackItem }) => (
    <View style={[styles.itemContainer, { backgroundColor: cardColor }]}>
      <View style={styles.header}>
        <View>
          <ThemedText style={styles.ticketId}>#{item.ticketId}</ThemedText>
          <ThemedText style={styles.date}>
            {formatDate(item.timestamp)}
          </ThemedText>
        </View>
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor:
                item.status === "resolved" ? "#34C759" : "#FF9500",
            },
          ]}
        >
          <Text style={styles.statusText}>
            {item.status === "resolved" ? "Resolved" : "Pending"}
          </Text>
        </View>
      </View>

      <View style={styles.content}>
        <ThemedText style={styles.name}>{item.name}</ThemedText>
        <ThemedText style={styles.email}>{item.email}</ThemedText>
        <ThemedText style={styles.message}>{item.message}</ThemedText>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: primaryColor }]}
          onPress={() => toggleStatus(item.ticketId, item.status)}
        >
          <MaterialIcons
            name={item.status === "pending" ? "check-circle" : "refresh"}
            size={20}
            color="white"
          />
          <Text style={styles.actionText}>
            {item.status === "pending" ? "Mark Resolved" : "Reopen"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, { backgroundColor: "#FF3B30" }]}
          onPress={() => handleDelete(item.ticketId)}
        >
          <MaterialIcons name="delete" size={20} color="white" />
          <Text style={styles.actionText}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          title: "Feedback Management",
          headerShown: true,
        }}
      />

      {loading && !refreshing ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={primaryColor} />
          <ThemedText style={styles.loadingText}>
            Loading feedback...
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={feedbackItems}
          renderItem={renderFeedbackItem}
          keyExtractor={(item) => item.ticketId}
          contentContainerStyle={styles.listContent}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialIcons name="inbox" size={60} color={secondaryColor} />
              <ThemedText style={styles.emptyText}>
                No feedback items found
              </ThemedText>
            </View>
          }
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  emptyContainer: {
    padding: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    textAlign: "center",
  },
  itemContainer: {
    borderRadius: 12,
    marginBottom: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  ticketId: {
    fontSize: 16,
    fontWeight: "bold",
  },
  date: {
    fontSize: 14,
    opacity: 0.6,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusText: {
    color: "white",
    fontSize: 12,
    fontWeight: "bold",
  },
  content: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "rgba(0, 0, 0, 0.03)",
  },
  name: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    marginBottom: 8,
    opacity: 0.8,
  },
  message: {
    fontSize: 15,
    lineHeight: 22,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    flex: 1,
    marginHorizontal: 4,
  },
  actionText: {
    color: "white",
    fontWeight: "bold",
    marginLeft: 6,
  },
});

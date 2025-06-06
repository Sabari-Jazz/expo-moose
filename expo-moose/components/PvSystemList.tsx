import React, { useEffect, useState } from "react";
import {
  FlatList,
  StyleSheet,
  View,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
} from "react-native";
import { router } from "expo-router";
import { getPvSystems, PvSystemMetadata } from "@/api/api";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { useThemeColor } from "@/hooks/useThemeColor";
import { LocalIonicon } from "./ui/LocalIonicon";
import { getCurrentUser, getAccessibleSystems } from "@/utils/cognitoAuth";
export type PvSystem = PvSystemMetadata;

export default function PvSystemList() {
  const [pvSystems, setPvSystems] = useState<PvSystem[]>([]);
  const [filteredSystems, setFilteredSystems] = useState<PvSystem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [accessibleSystemIds, setAccessibleSystemIds] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const primaryColor = useThemeColor({}, "tint");

  useEffect(() => {
    const getUserAccessibleSystems = async () => {
      try {
        const user = await getCurrentUser();
        if (!user) {
          setAccessibleSystemIds([]);
          setIsAdmin(false);
          return;
        }

        setIsAdmin(user.role === "admin");
        const systemIds = await getAccessibleSystems(user.id);
        setAccessibleSystemIds(systemIds);
      } catch (error) {
        console.error("Error getting accessible systems:", error);
        setAccessibleSystemIds([]);
      }
    };

    getUserAccessibleSystems();
  }, []);

  useEffect(() => {
    const fetchPvSystems = async () => {
      try {
        setLoading(true);
        const data = await getPvSystems(0, 1000);

        let systemsToShow = data;
        if (!isAdmin && accessibleSystemIds.length > 0) {
          systemsToShow = data.filter((system) =>
            accessibleSystemIds.includes(system.pvSystemId)
          );
        }

        setPvSystems(systemsToShow);
        setFilteredSystems(systemsToShow);
        setError(null);
      } catch (err) {
        console.error("Error fetching PV systems:", err);
        setError("Failed to load PV systems. Please try again later.");
      } finally {
        setLoading(false);
      }
    };

    fetchPvSystems();
  }, [isAdmin, accessibleSystemIds]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredSystems(pvSystems);
      return;
    }

    const lowercaseQuery = searchQuery.toLowerCase();
    const filtered = pvSystems.filter(
      (system) =>
        system.name.toLowerCase().includes(lowercaseQuery) ||
        system.pvSystemId.toLowerCase().includes(lowercaseQuery) ||
        (system.address.city &&
          system.address.city.toLowerCase().includes(lowercaseQuery)) ||
        (system.address.country &&
          system.address.country.toLowerCase().includes(lowercaseQuery))
    );

    setFilteredSystems(filtered);
  }, [searchQuery, pvSystems]);

  const navigateToMap = (pvSystem: PvSystem) => {
    router.push({
      pathname: "/map",
      params: { pvSystemId: pvSystem.pvSystemId },
    });
  };

  const navigateToDetail = (pvSystem: PvSystem) => {
    router.push(`/pv-detail/${pvSystem.pvSystemId}` as any);
  };

  if (loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator size="large" color={primaryColor} />
        <ThemedText style={styles.loadingText} type="caption">
          Loading PV Systems...
        </ThemedText>
      </ThemedView>
    );
  }

  if (error) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText style={styles.errorText} type="error">
          {error}
        </ThemedText>
      </ThemedView>
    );
  }

  if (pvSystems.length === 0) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText style={styles.noResultsText} type="error">
          {isAdmin
            ? "No PV systems found."
            : "You don't have access to any PV systems."}
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ThemedText style={styles.headerText} type="title">
        Solar PV Systems
      </ThemedText>

      {/* Search Bar */}
      <ThemedView type="card" style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <LocalIonicon
            name="search"
            size={20}
            color="#757575"
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, ID, or location"
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor="#9E9E9E"
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery("")}>
              <LocalIonicon name="close-circle" size={20} color="#757575" />
            </TouchableOpacity>
          )}
        </View>
      </ThemedView>

      {/* Results Count */}
      <ThemedText type="caption" style={styles.resultsCount}>
        {filteredSystems.length} systems found
      </ThemedText>

      {!isAdmin && accessibleSystemIds.length > 0 && (
        <ThemedText type="caption" style={styles.accessMessage}>
          You have access to {accessibleSystemIds.length} out of{" "}
          {pvSystems.length} systems.
        </ThemedText>
      )}

      <FlatList
        data={filteredSystems}
        keyExtractor={(item) => item.pvSystemId}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => navigateToDetail(item)}
            activeOpacity={0.7}
          >
            <ThemedView type="elevated" style={styles.card}>
              <View style={styles.cardContent}>
                <View style={styles.imageContainer}>
                  {item.pictureURL ? (
                    <Image
                      source={{ uri: item.pictureURL }}
                      style={styles.image}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.placeholderImage}>
                      <ThemedText type="caption">No Image</ThemedText>
                    </View>
                  )}
                </View>
                <View style={styles.infoContainer}>
                  <ThemedText type="heading" style={styles.name}>
                    {item.name}
                  </ThemedText>
                  <ThemedText type="caption" style={styles.address}>
                    {`${item.address.street}, ${item.address.city}${
                      item.address.country ? `, ${item.address.country}` : ""
                    }`}
                  </ThemedText>
                  <ThemedText type="body" style={styles.details}>
                    Peak Power: {item.peakPower} W
                  </ThemedText>
                  <ThemedText type="caption" style={styles.details}>
                    Last Update:{" "}
                    {new Date(item.lastImport).toLocaleDateString()}
                  </ThemedText>
                </View>
              </View>
            </ThemedView>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <ThemedView type="card" style={styles.emptyStateContainer}>
            <ThemedText type="subheading" style={styles.emptyStateText}>
              No systems found matching your search.
            </ThemedText>
            <TouchableOpacity
              style={styles.clearSearchButton}
              onPress={() => setSearchQuery("")}
            >
              <ThemedText type="link">Clear Search</ThemedText>
            </TouchableOpacity>
          </ThemedView>
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  headerText: {
    marginBottom: 16,
  },
  searchContainer: {
    marginBottom: 12,
    padding: 0,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    height: 48,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 40,
    fontSize: 16,
  },
  resultsCount: {
    marginBottom: 8,
    textAlign: "right",
    paddingRight: 4,
  },
  card: {
    marginTop: 16,
    marginBottom: 16,
  },
  cardContent: {
    flexDirection: "row",
  },
  imageContainer: {
    width: 120,
    height: 120,
    borderRadius: 8,
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  placeholderImage: {
    width: "100%",
    height: "100%",
    backgroundColor: "#e0e0e0",
    justifyContent: "center",
    alignItems: "center",
  },
  infoContainer: {
    flex: 1,
    paddingLeft: 12,
  },
  name: {
    marginBottom: 4,
  },
  address: {
    marginBottom: 8,
  },
  details: {
    marginBottom: 2,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
  },
  errorText: {
    textAlign: "center",
  },
  emptyStateContainer: {
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  emptyStateText: {
    textAlign: "center",
    marginBottom: 10,
  },
  clearSearchButton: {
    padding: 8,
  },
  accessMessage: {
    fontSize: 14,
    color: "#666",
    fontStyle: "italic",
    marginHorizontal: 16,
    marginBottom: 8,
  },
  noResultsText: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
  },
});

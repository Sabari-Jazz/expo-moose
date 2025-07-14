import React, { useState, useEffect, useCallback } from "react";
import {
  StyleSheet,
  View,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Image,
  TextInput,
} from "react-native";
import { Text, Card, IconButton, Divider } from "react-native-paper";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInUp, FadeOutDown } from "react-native-reanimated";
import { StatusBar } from "expo-status-bar";
import {
  getConsolidatedDailyData,
  PvSystemMetadata,
  getSystemProfile,
} from "@/api/api";
import { getCurrentUser } from "@/utils/cognitoAuth";
import StatusIcon from "@/components/StatusIcon";
import SummaryStatusIcon from "@/components/SummaryStatusIcon";
import UserMenuDrawer from "@/components/UserMenuDrawer";
import { useSession } from "@/utils/sessionContext";
import IncidentModal from "@/components/IncidentModal";

interface EnhancedPvSystem {
  id: string;
  name: string;
  address: string;
  status: "online" | "offline" | "warning";
  power: string;
  daily: string;
  lastUpdated: string;
  pictureURL: string | null;
  peakPower: number;
  isActive: boolean;
}

export default function DashboardScreen() {
  const { isDarkMode, colors } = useTheme();
  const { incidents, loadIncidents, pendingIncidentsCount, hasShownIncidentsThisSession, markIncidentsAsShown } = useSession();
  const [refreshing, setRefreshing] = useState(false);
  const [allSystems, setAllSystems] = useState<EnhancedPvSystem[]>([]);
  const [filteredSystems, setFilteredSystems] = useState<EnhancedPvSystem[]>([]);
  const [displayedSystems, setDisplayedSystems] = useState<EnhancedPvSystem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [currentUser, setCurrentUser] = useState<{
    id: string;
    role: string;
    name?: string;
    systems?: string[];
  } | null>(null);
  const [userMenuVisible, setUserMenuVisible] = useState(false);
  const [incidentModalVisible, setIncidentModalVisible] = useState(false);

  const SYSTEMS_PER_PAGE = 10;

  // Helper function to format energy with automatic unit conversion
  const formatEnergyValue = (energyWh: number): string => {
    if (energyWh >= 1000) {
      return `${(energyWh / 1000).toFixed(1)} kWh`;
    } else {
      return `${energyWh.toFixed(1)} Wh`;
    }
  };

  // Helper function to format power with automatic unit conversion
  const formatPowerValue = (powerW: number): string => {
    if (powerW >= 1000) {
      return `${(powerW / 1000).toFixed(1)} kW`;
    } else {
      return `${powerW.toFixed(1)} W`;
    }
  };

  // Helper functions for data extraction
  const formatAddress = (address: PvSystemMetadata["address"]): string => {
    const parts = [
      address.street,
      address.city,
      address.state,
      address.country,
    ].filter(Boolean);
    return parts.join(", ");
  };

  const determineStatus = (consolidatedData: any): "online" | "offline" | "warning" => {
    // System is online if it has recent data and some power output
    if (consolidatedData?.currentPowerW !== undefined) {
      return "online";
    }
    return "offline";
  };

  const extractPower = (consolidatedData: any): string => {
    if (consolidatedData?.currentPowerW !== undefined) {
      const powerW = Number(consolidatedData.currentPowerW);
      return formatPowerValue(powerW);
    }
    return "0.0 W";
  };

  const extractDailyEnergy = (consolidatedData: any): string => {
    if (consolidatedData?.energyProductionWh !== undefined) {
      const energyWh = Number(consolidatedData.energyProductionWh);
      return formatEnergyValue(energyWh);
    }
    return "0.0 Wh";
  };

  const formatLastUpdated = (dateTimeString: string): string => {
    try {
      const date = new Date(dateTimeString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);

      if (diffMins < 1) return "just now";
      if (diffMins < 60) return `${diffMins} min ago`;
      if (diffMins < 1440) return `${Math.floor(diffMins / 60)} hr ago`;
      return date.toLocaleDateString();
    } catch (e) {
      return "unknown";
    }
  };

  const formatPvSystemData = (
    system: PvSystemMetadata,
    consolidatedData: any
  ): EnhancedPvSystem => {
    const address = formatAddress(system.address);
    const status = determineStatus(consolidatedData);
    const power = extractPower(consolidatedData);
    const daily = extractDailyEnergy(consolidatedData);

    return {
      id: system.pvSystemId,
      name: system.name,
      address: address,
      status: status,
      power: power,
      daily: daily,
      lastUpdated: formatLastUpdated(consolidatedData?.updatedAt || system.lastImport),
      pictureURL: system.pictureURL,
      peakPower: 25000, // Placeholder value as requested
      isActive: status === "online" || status === "warning",
    };
  };

  // Load all systems data
  const loadAllSystemsData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Get current user
      const user = await getCurrentUser();
      setCurrentUser(user);

      // Both admin and regular users now get their systems from user.systems
      let systemsToLoad: string[] = [];
      if (user && 'systems' in user && user.systems && (user.systems as string[]).length > 0) {
        systemsToLoad = user.systems as string[];
        console.log(`User ${user.name} (${user.role}) loading ${systemsToLoad.length} systems`);
      } else {
        // No systems assigned
        console.log(`User ${user?.name} has no systems assigned`);
        setAllSystems([]);
        setFilteredSystems([]);
        updateDisplayedSystems([], 0);
        setLoading(false);
        return;
      }

      if (systemsToLoad.length === 0) {
        setAllSystems([]);
        setFilteredSystems([]);
        updateDisplayedSystems([], 0);
        setLoading(false);
        return;
      }

      // Get system metadata efficiently - fetch only the systems the user has access to
      const systemsMetadata = await Promise.all(
        systemsToLoad.map(async (systemId) => {
          try {
            const systemProfile = await getSystemProfile(systemId);
            if (!systemProfile) {
              console.warn(`No profile found for system ${systemId}`);
              return null;
            }
            
            // Convert to PvSystemMetadata format
            return {
              pvSystemId: systemId,
              name: systemProfile.name || `System ${systemId}`,
              address: {
                street: systemProfile.street || "",
                city: systemProfile.city || "",
                state: systemProfile.state || "",
                country: systemProfile.country || "",
              },
              pictureURL: systemProfile.pictureUrl || null,
              peakPower: systemProfile.peakPower || 25000,
              lastImport: systemProfile.lastImport || new Date().toISOString(),
            } as PvSystemMetadata;
          } catch (error) {
            console.error(`Error fetching system ${systemId}:`, error);
            return null;
          }
        })
      );
      
      const validSystemsMetadata = systemsMetadata.filter((system): system is PvSystemMetadata => system !== null);

      // Get today's date for consolidated data
      const today = new Date();
      const formatter = new Intl.DateTimeFormat('en-CA', { 
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit', 
        day: '2-digit'
      });
      const todayDateString = formatter.format(today);

      // Load consolidated data for each system
      const enhancedSystems = await Promise.all(
        validSystemsMetadata.map(async (system) => {
          try {
            console.log(`Loading consolidated data for system: ${system.name}`);

            // Only get consolidated daily data - that's all we need for dashboard
            const consolidatedDaily = await getConsolidatedDailyData(system.pvSystemId, todayDateString).catch(err => {
              console.warn(`Consolidated daily data failed for ${system.pvSystemId}:`, err);
              return null;
            });

            if (consolidatedDaily) {
              console.log(`✓ Consolidated data loaded for ${system.name}: Power=${consolidatedDaily.currentPowerW}W, Energy=${consolidatedDaily.energyProductionWh}Wh`);
            } else {
              console.log(`✗ No consolidated data for ${system.name}`);
            }

            return formatPvSystemData(system, consolidatedDaily);
          } catch (error) {
            console.error(`Error loading data for system ${system.pvSystemId}:`, error);
            // Return system with minimal data
            return formatPvSystemData(system, null);
          }
        })
      );

      // Sort systems: active first, then by name
      const sortedSystems = enhancedSystems.sort((a, b) => {
        if (a.isActive && !b.isActive) return -1;
        if (!a.isActive && b.isActive) return 1;
        return a.name.localeCompare(b.name);
      });

      console.log(`Successfully loaded ${sortedSystems.length} systems`);
      setAllSystems(sortedSystems);
      setFilteredSystems(sortedSystems);
      updateDisplayedSystems(sortedSystems, 0);
    } catch (error) {
      console.error("Error loading systems:", error);
      setError("Failed to load systems. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Update displayed systems based on current page
  const updateDisplayedSystems = (systems: EnhancedPvSystem[], page: number) => {
    const startIndex = page * SYSTEMS_PER_PAGE;
    const endIndex = startIndex + SYSTEMS_PER_PAGE;
    setDisplayedSystems(systems.slice(0, endIndex));
    setCurrentPage(page);
  };

  // Handle search
  const handleSearch = (query: string) => {
    setSearchQuery(query);
    
    if (!query.trim()) {
      setFilteredSystems(allSystems);
      updateDisplayedSystems(allSystems, 0);
      return;
    }

    const lowercaseQuery = query.toLowerCase();
    const filtered = allSystems.filter(
      (system) =>
        system.name.toLowerCase().includes(lowercaseQuery) ||
        system.id.toLowerCase().includes(lowercaseQuery) ||
        system.address.toLowerCase().includes(lowercaseQuery)
    );

    setFilteredSystems(filtered);
    updateDisplayedSystems(filtered, 0);
  };

  // Load more systems (client-side pagination)
  const handleLoadMore = () => {
    const nextPage = currentPage + 1;
    const maxPage = Math.ceil(filteredSystems.length / SYSTEMS_PER_PAGE) - 1;
    
    if (nextPage <= maxPage) {
      updateDisplayedSystems(filteredSystems, nextPage);
    }
  };

  // Check if there are more systems to load
  const hasMoreSystems = () => {
    return displayedSystems.length < filteredSystems.length;
  };

  // Refresh handler
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setCurrentPage(0);
    loadAllSystemsData().finally(() => {
      setRefreshing(false);
    });
  }, []);

  // Load all systems data on component mount
  useEffect(() => {
    loadAllSystemsData();
  }, []);

  // Update modal visibility when pending incidents count changes
  useEffect(() => {
    if (pendingIncidentsCount > 0 && !incidentModalVisible && !hasShownIncidentsThisSession) {
      setIncidentModalVisible(true);
    }
  }, [pendingIncidentsCount, incidentModalVisible, hasShownIncidentsThisSession]);

  // Handle search query changes
  useEffect(() => {
    handleSearch(searchQuery);
  }, [searchQuery, allSystems]);

  const navigateToDetail = (pvSystemId: string) => {
    console.log(`Navigating to detail for system ${pvSystemId}`);
    router.push(`/pv-detail/${pvSystemId}`);
  };

  const renderPvSystem = ({
    item,
    index,
  }: {
    item: EnhancedPvSystem;
    index: number;
  }) => {
    return (
      <Animated.View
        entering={FadeInUp.delay(index * 100).springify()}
        exiting={FadeOutDown}
      >
        <Card
          style={[
            styles.card,
            { backgroundColor: isDarkMode ? colors.card : "#fff" },
          ]}
          onPress={() => navigateToDetail(item.id)}
        >
          <Card.Content style={styles.cardContentContainer}>
            <View style={styles.cardRow}>
              <View style={styles.imageContainer}>
                {item.pictureURL ? (
                  <Image
                    source={{ uri: item.pictureURL }}
                    style={styles.image}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.placeholderImage}>
                    <Ionicons name="sunny-outline" size={40} color="#9E9E9E" />
                  </View>
                )}
              </View>

              <View style={styles.cardContent}>
                <View style={styles.cardHeader}>
                  <View style={styles.titleContainer}>
                    <Text
                      variant="titleMedium"
                      style={[styles.systemName, { color: colors.text }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {item.name}
                    </Text>
                    <View style={styles.statusChipContainer}>
                      <StatusIcon systemId={item.id} />
                    </View>
                  </View>
                </View>

                <Text
                  variant="bodySmall"
                  style={{ color: colors.text, opacity: 0.7, marginBottom: 4 }}
                >
                  {item.address}
                </Text>

                <Text
                  variant="bodySmall"
                  style={{
                    color: colors.text,
                    opacity: 0.7,
                    marginBottom: 8,
                  }}
                >
                  Peak Power: {(item.peakPower / 1000).toFixed(1)} kWp
                </Text>
              </View>
            </View>

            <Divider style={{ marginVertical: 8 }} />

            <View style={styles.statsContainer}>
              <View style={styles.statItem}>
                <Ionicons name="flash" size={18} color={colors.primary} />
                <Text style={[styles.statValue, { color: colors.text }]}>
                  {item.power}
                </Text>
                <Text
                  style={[
                    styles.statLabel,
                    { color: colors.text, opacity: 0.7 },
                  ]}
                >
                  Current
                </Text>
              </View>

              <View style={styles.statDivider} />

              <View style={styles.statItem}>
                <Ionicons name="sunny" size={18} color={colors.primary} />
                <Text style={[styles.statValue, { color: colors.text }]}>
                  {item.daily}
                </Text>
                <Text
                  style={[
                    styles.statLabel,
                    { color: colors.text, opacity: 0.7 },
                  ]}
                >
                  Today
                </Text>
              </View>

              <View style={styles.statDivider} />

              <View style={styles.statItem}>
                <Ionicons name="time" size={18} color={colors.primary} />
                <Text style={[styles.statValue, { color: colors.text }]}>
                  {item.lastUpdated}
                </Text>
                <Text
                  style={[
                    styles.statLabel,
                    { color: colors.text, opacity: 0.7 },
                  ]}
                >
                  Updated
                </Text>
              </View>
            </View>
          </Card.Content>
        </Card>
      </Animated.View>
    );
  };

  const renderFooter = () => {
    if (hasMoreSystems()) {
      return (
        <TouchableOpacity
          style={[styles.loadMoreButton, { backgroundColor: colors.primary }]}
          onPress={handleLoadMore}
        >
          <Text style={styles.loadMoreButtonText}>Load More</Text>
        </TouchableOpacity>
      );
    }

    if (filteredSystems.length > 0) {
      return (
        <View style={styles.footerMessage}>
          <Text style={[styles.footerText, { color: colors.text }]}>
            All systems loaded
          </Text>
        </View>
      );
    }

    return null;
  };

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: isDarkMode ? colors.background : "#f5f5f5" },
      ]}
      edges={["top", "left", "right"]}
    >
      <StatusBar style={isDarkMode ? "light" : "dark"} />

      <View style={styles.header}>
        <Text
          variant="headlineMedium"
          style={{ color: colors.text, fontWeight: "700" }}
        >
          Solar Systems
          {currentUser &&  (
            <Text
              variant="titleSmall"
              style={{ color: colors.primary, fontWeight: "400" }}
            >
              {" "}
              (v2.5.1)
            </Text>
          )}
          
        </Text>
        <View style={styles.headerButtons}>
          <IconButton
            icon="refresh"
            iconColor={colors.primary}
            size={24}
            onPress={onRefresh}
            disabled={refreshing}
          />
          <IconButton
            icon="menu"
            iconColor={colors.primary}
            size={24}
            onPress={() => setUserMenuVisible(true)}
           
          />
        </View>
      </View>

      {/* Search Bar */}
      <View
        style={[
          styles.searchContainer,
          { backgroundColor: isDarkMode ? colors.card : "#fff" },
        ]}
      >
        <Ionicons
          name="search"
          size={20}
          color={isDarkMode ? "#bbb" : "#757575"}
          style={styles.searchIcon}
        />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search by name, ID, or location"
          placeholderTextColor={isDarkMode ? "#888" : "#9E9E9E"}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery("")}>
            <Ionicons
              name="close-circle"
              size={20}
              color={isDarkMode ? "#bbb" : "#757575"}
            />
          </TouchableOpacity>
        )}
      </View>

      {/* Results Count */}
      <View style={styles.resultsCountContainer}>
        <Text
          style={[styles.resultsCount, { color: colors.text, opacity: 0.6 }]}
        >
          {filteredSystems.length} systems found
          {allSystems.length > 0 && ` (${allSystems.length} total)`}
        </Text>
      </View>

      {/* Summary Status Icon */}
      {!loading && !error && filteredSystems.length > 0 && (
        <View style={styles.summaryStatusContainer}>
          <SummaryStatusIcon showCount={true} />
        </View>
      )}

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.text }]}>
            Loading your solar systems...
          </Text>
        </View>
      ) : error ? (
        <View style={styles.loadingContainer}>
          <Text style={[styles.loadingText, { color: colors.text }]}>
            {error}
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={onRefresh}>
            <Text style={{ color: colors.primary }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={displayedSystems}
          renderItem={renderPvSystem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyStateContainer}>
              <Text style={[styles.emptyStateText, { color: colors.text }]}>
                {searchQuery ? "No systems found matching your search." : "No systems assigned to your account."}
              </Text>
              {searchQuery && (
                <TouchableOpacity
                  style={styles.clearSearchButton}
                  onPress={() => setSearchQuery("")}
                >
                  <Text style={{ color: colors.primary }}>Clear Search</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          ListFooterComponent={renderFooter}
        />
      )}

      {/* User Menu Drawer */}
      <UserMenuDrawer
        isVisible={userMenuVisible}
        onClose={() => setUserMenuVisible(false)}
        currentUser={currentUser}
      />

      {/* Incident Modal */}
      <IncidentModal
        visible={incidentModalVisible}
        onDismiss={() => {
          setIncidentModalVisible(false);
          markIncidentsAsShown();
        }}
        incidents={incidents}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "space-between", // Push title left and buttons right
    alignItems: "center",
    marginTop: 8,
  },
  headerButtons: {
    flexDirection: "row",
    alignItems: "center", // Changed from flex-start to center
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 12,
    height: 48,
    borderRadius: 12,
    elevation: 1,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 1,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 40,
    fontSize: 16,
  },
  resultsCountContainer: {
    marginHorizontal: 16,
    marginBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  resultsCount: {
    fontSize: 14,
  },
  summaryStatusContainer: {
    marginBottom: 8,
    alignItems: "center",
    width: "100%",
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  card: {
    marginBottom: 16,
    borderRadius: 12,
    overflow: "hidden",
  },
  cardContentContainer: {
    paddingTop: 12,
  },
  cardRow: {
    flexDirection: "row",
    marginBottom: 4,
  },
  imageContainer: {
    width: 80,
    height: 80,
    marginRight: 12,
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
    backgroundColor: "#f0f0f0",
    justifyContent: "center",
    alignItems: "center",
  },
  cardContent: {
    flex: 1,
  },
  cardHeader: {
    flexDirection: "row",
    marginBottom: 4,
    width: "100%",
  },
  titleContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  statusChipContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    marginLeft: 8,
  },
  systemName: {
    fontWeight: "600",
    flex: 1,
    marginRight: 4,
  },
  statsContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: "rgba(0,0,0,0.1)",
  },
  statValue: {
    fontSize: 16,
    fontWeight: "bold",
    marginVertical: 2,
  },
  statLabel: {
    fontSize: 12,
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
  retryButton: {
    marginTop: 16,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: "rgba(0,0,0,0.05)",
    borderRadius: 8,
  },
  emptyStateContainer: {
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  emptyStateText: {
    fontSize: 16,
    textAlign: "center",
    marginBottom: 10,
  },
  clearSearchButton: {
    padding: 8,
  },
  footerMessage: {
    padding: 16,
    alignItems: "center",
  },
  footerText: {
    fontSize: 14,
    color: "#888",
  },
  loadMoreButton: {
    margin: 16,
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  loadMoreButtonText: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#fff",
  },
});

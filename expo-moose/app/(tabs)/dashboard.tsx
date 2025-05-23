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
import { Text, Card, Chip, IconButton, Divider } from "react-native-paper";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInUp, FadeOutDown } from "react-native-reanimated";
import { StatusBar } from "expo-status-bar";
import {
  getPvSystems,
  getPvSystemFlowData,
  PvSystemMetadata,
  FlowDataResponse,
  AggregatedDataResponse,
  SystemMessage,
} from "@/api/api";
import * as api from "@/api/api";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getCurrentUser, getAccessibleSystems } from "@/utils/auth";
import StatusIcon from "@/components/StatusIcon";
import SummaryStatusIcon from "@/components/SummaryStatusIcon";

interface EnhancedPvSystem {
  id: string;
  name: string;
  address: string;
  status: "online" | "offline" | "warning";
  power: string;
  daily: string;
  lastUpdated: string;
  pictureURL: string | null;
  peakPower: number | null;
  isActive: boolean;
  errorMessages?: SystemMessage[];
}

interface BasicPvSystem {
  id: string;
  name: string;
  address: string;
  pictureURL: string | null;
}

export default function DashboardScreen() {
  const { isDarkMode, colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [pvSystems, setPvSystems] = useState<EnhancedPvSystem[]>([]);
  const [filteredSystems, setFilteredSystems] = useState<EnhancedPvSystem[]>(
    []
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalSystems, setTotalSystems] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMorePages, setHasMorePages] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [allSystemsBasicInfo, setAllSystemsBasicInfo] = useState<
    BasicPvSystem[]
  >([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingAllSystems, setIsLoadingAllSystems] = useState(true);
  const SYSTEMS_PER_PAGE = 10;
  const [demoMode, setDemoMode] = useState(false);
  const [currentUser, setCurrentUser] = useState<{
    id: string;
    role: string;
    name?: string;
  } | null>(null);
  const [accessibleSystemIds, setAccessibleSystemIds] = useState<string[]>([]);

  // Helper function to format date for API calls
  const getShortDateString = (date: Date): string => {
    return date.toISOString().split("T")[0];
  };

  // Load current user and accessible systems
  useEffect(() => {
    const loadUserAndAccessibleSystems = async () => {
      try {
        const user = await getCurrentUser();
        setCurrentUser(user);

        if (user) {
          const systemIds = getAccessibleSystems(user.id);
          setAccessibleSystemIds(systemIds);
          console.log(
            `User ${user.name} has access to ${
              systemIds.length === 0 ? "all" : systemIds.length
            } systems`
          );
        }
      } catch (error) {
        console.error("Error loading user and accessible systems:", error);
      }
    };

    loadUserAndAccessibleSystems();
  }, []);

  // Filter function to check if current user has access to a system
  const hasAccessToSystem = (systemId: string): boolean => {
    // If user is null or not loaded yet, don't show any systems
    if (!currentUser) return false;

    // Admin role has access to all systems
    if (currentUser.role === "admin") return true;

    // For regular users, check against accessible system IDs
    // Empty array means all systems are accessible (for admin)
    return (
      accessibleSystemIds.length === 0 || accessibleSystemIds.includes(systemId)
    );
  };

  // Helper functions
  const formatAddress = (address: PvSystemMetadata["address"]): string => {
    const parts = [
      address.street,
      address.city,
      address.state,
      address.country,
    ].filter(Boolean);
    return parts.join(", ");
  };

  const determineStatus = (
    flowData: FlowDataResponse | null,
    errorMessages: SystemMessage[] = []
  ): "online" | "offline" | "warning" => {
    if (!flowData || !flowData.status || !flowData.status.isOnline) {
      return "offline";
    }

    // System is online, but has error messages - mark as warning
    if (errorMessages && errorMessages.length > 0) {
      return "warning";
    }

    return "online";
  };

  const extractPower = (flowData: FlowDataResponse | null): string => {
    if (!flowData || !flowData.data || !flowData.data.channels) {
      return "0 kW";
    }

    const powerChannel = flowData.data.channels.find(
      (channel) => channel.channelName === "PowerPV"
    );

    if (powerChannel && powerChannel.value !== null) {
      const powerValue = Number(powerChannel.value);
      return `${(powerValue / 1000).toFixed(1)} kW`;
    }

    return "0 kW";
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

  const extractDailyEnergy = (
    aggrData: api.AggregatedDataResponse | null
  ): string => {
    if (
      !aggrData ||
      !aggrData.data ||
      !aggrData.data[0] ||
      !aggrData.data[0].channels
    ) {
      return "0 kWh";
    }

    // Look for the standard energy production channel in aggregated data
    const energyChannel = aggrData.data[0].channels.find(
      (channel) =>
        channel.channelName === "EnergyProductionTotal" ||
        channel.channelName === "EnergyProduction" ||
        channel.channelName === "EnergyDay"
    );

    if (energyChannel && energyChannel.value !== null) {
      const energyValue = Number(energyChannel.value);
      // Aggregated energy is often in Wh, convert to kWh if necessary
      return `${(energyValue / 1000).toFixed(1)} kWh`;
    }

    return "0 kWh";
  };

  // Fix the date format for API calls - format to match API requirements
  const formatApiDateString = (date: Date): string => {
    // Format to YYYY-MM-DDThh:mm:ssZ without milliseconds
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`;
  };

  // Format PV system data for display
  const formatPvSystemData = (
    system: api.PvSystemMetadata,
    flowData: api.FlowDataResponse | null,
    aggrToday: api.AggregatedDataResponse | null,
    errorMessages: SystemMessage[] = []
  ): EnhancedPvSystem => {
    // Format the address
    const address = formatAddress(system.address);

    // Determine system status based on flow data and error messages
    const status = determineStatus(flowData, errorMessages);

    // Extract and format current power
    const power = extractPower(flowData);

    // Extract daily energy production from aggregated data
    const daily = extractDailyEnergy(aggrToday);

    return {
      id: system.pvSystemId,
      name: system.name,
      address: address,
      status: status,
      power: power,
      daily: daily,
      lastUpdated: formatLastUpdated(
        flowData?.data?.logDateTime || system.lastImport
      ),
      pictureURL: system.pictureURL,
      peakPower: system.peakPower,
      isActive: status === "online" || status === "warning",
      errorMessages: errorMessages,
    };
  };

  // Format a basic system object (lightweight, for search only)
  const formatBasicSystemData = (
    system: api.PvSystemMetadata
  ): BasicPvSystem => {
    return {
      id: system.pvSystemId,
      name: system.name,
      address: formatAddress(system.address),
      pictureURL: system.pictureURL,
    };
  };

  // Load all systems basic info for search functionality
  const loadAllSystemsBasicInfo = async () => {
    try {
      setIsLoadingAllSystems(true);

      // Get all systems with higher limit (all systems)
      const allSystemsData = await api.getPvSystems(0, 1000);

      if (!allSystemsData || allSystemsData.length === 0) {
        setIsLoadingAllSystems(false);
        return;
      }

      console.log(`Loaded ${allSystemsData.length} systems for search`);

      // Map to basic info without loading flow data or other details
      let basicSystemsInfo = allSystemsData.map(formatBasicSystemData);

      // Filter systems based on access if user is not admin
      if (
        currentUser &&
        currentUser.role !== "admin" &&
        accessibleSystemIds.length > 0
      ) {
        basicSystemsInfo = basicSystemsInfo.filter((system) =>
          hasAccessToSystem(system.id)
        );
        console.log(
          `Filtered to ${basicSystemsInfo.length} accessible systems for user ${currentUser.name}`
        );
      }

      setAllSystemsBasicInfo(basicSystemsInfo);
      setTotalSystems(basicSystemsInfo.length);
      setIsLoadingAllSystems(false);
    } catch (error) {
      console.error("Failed to load all systems basic info:", error);
      setIsLoadingAllSystems(false);
    }
  };

  const applySearchFilter = async (query: string) => {
    setIsSearching(true);

    if (!query.trim()) {
      // If search is cleared, revert to paginated view
      setIsSearching(false);
      setFilteredSystems(pvSystems);
      return;
    }

    const lowercaseQuery = query.toLowerCase();

    // First, filter the basic info of all systems
    const matchedBasicSystems = allSystemsBasicInfo.filter(
      (system) =>
        system.name.toLowerCase().includes(lowercaseQuery) ||
        system.id.toLowerCase().includes(lowercaseQuery) ||
        system.address.toLowerCase().includes(lowercaseQuery)
    );

    if (matchedBasicSystems.length === 0) {
      // No matches found, set empty filtered systems
      setFilteredSystems([]);
      setIsSearching(false);
      return;
    }

    // Get enhanced data for matched systems (up to a reasonable limit)
    const systemsToLoad = matchedBasicSystems.slice(0, 20); // Load at most 20 matches

    try {
      // Load detailed data for the matched systems
      const enhancedMatchedSystems = await Promise.all(
        systemsToLoad.map(async (basicSystem) => {
          try {
            // Check if we already have this system with enhanced data
            const existingSystem = pvSystems.find(
              (sys) => sys.id === basicSystem.id
            );
            if (existingSystem) {
              return existingSystem;
            }

            // Otherwise fetch the flow data for this system
            const flowData = await api.getPvSystemFlowData(basicSystem.id);

            // Get the full system details
            const fullSystemData = await api.getPvSystemDetails(basicSystem.id);

            // Fetch aggregated data for today
            const aggrToday = await api.getPvSystemAggregatedData(
              basicSystem.id,
              {
                from: getShortDateString(new Date()),
                duration: 1,
              }
            );

            // Fetch error messages from the last 24 hours
            let errorMessages: SystemMessage[] = [];
            try {
              const fromDate = new Date();
              fromDate.setDate(fromDate.getDate() - 1); // Go back 1 day

              // Use the correctly formatted date string
              const formattedFromDate = formatApiDateString(fromDate);

              errorMessages = await api.getPvSystemMessages(basicSystem.id, {
                from: formattedFromDate,
                stateseverity: "Error",
                limit: 5, // Limit to the most recent 5 errors
              });

              if (errorMessages.length > 0) {
                console.log(
                  `System ${basicSystem.id} has ${errorMessages.length} error messages`
                );
              }
            } catch (msgErr) {
              console.warn(
                `Failed to fetch error messages for ${basicSystem.id}:`,
                msgErr
              );
            }

            // Format with flow data and aggregated data
            return formatPvSystemData(
              fullSystemData,
              flowData,
              aggrToday,
              errorMessages
            );
          } catch (err) {
            console.error(
              `Error fetching data for search result ${basicSystem.id}:`,
              err
            );

            // Create a partial enhanced system with minimal data
            return {
              id: basicSystem.id,
              name: basicSystem.name,
              address: basicSystem.address,
              status: "offline" as "online" | "offline" | "warning",
              power: "0 kW",
              daily: "0 kWh",
              lastUpdated: "unknown",
              pictureURL: basicSystem.pictureURL,
              peakPower: null,
              isActive: false,
              errorMessages: [],
            };
          }
        })
      );

      // Update filtered systems with the enhanced data
      setFilteredSystems(enhancedMatchedSystems);
    } catch (error) {
      console.error("Error loading search results detail data:", error);
    } finally {
      setIsSearching(false);
    }
  };

  // Handle search query changes
  useEffect(() => {
    if (allSystemsBasicInfo.length > 0) {
      applySearchFilter(searchQuery);
    } else if (pvSystems.length > 0) {
      // Fallback to basic filtering if we don't have all systems loaded yet
      const lowercaseQuery = searchQuery.toLowerCase();
      const filtered = pvSystems.filter(
        (system) =>
          system.name.toLowerCase().includes(lowercaseQuery) ||
          system.id.toLowerCase().includes(lowercaseQuery) ||
          system.address.toLowerCase().includes(lowercaseQuery)
      );
      setFilteredSystems(filtered);
    }
  }, [searchQuery, allSystemsBasicInfo]);

  // Initial load
  useEffect(() => {
    // Load the first page of systems with details
    loadPvSystemsPage(0);

    // Load all systems basic info for search
    loadAllSystemsBasicInfo();
  }, [currentUser, accessibleSystemIds]);

  // Function to load a page of PV systems from the API
  const loadPvSystemsPage = async (page: number, showLoading = true) => {
    try {
      if(currentUser) {
        if (showLoading) {
          if (page === 0) {
            setLoading(true);
          } else {
            setIsLoadingMore(true);
          }
        }

        const offset = page * SYSTEMS_PER_PAGE;

        // Fetch a page of PV systems with pagination parameters
        let systemsData = await api.getPvSystems(offset);

        if (!systemsData || systemsData.length === 0) {
          if (page === 0) {
            setError("No PV systems found");
          }
          setHasMorePages(false);
          setLoading(false);
          setIsLoadingMore(false);
          return;
        }
        

        console.log(`Fetched ${systemsData.length} PV systems for page ${page}`);

        // Filter systems based on user access
        const accessibleSystemsData =
          currentUser?.role === "admin" 
            ? systemsData
            : systemsData.filter((system) =>
                hasAccessToSystem(system.pvSystemId)
              );
        const displayData = accessibleSystemsData.slice(offset, (page + 1) * SYSTEMS_PER_PAGE);

        console.log(
          `User ${currentUser?.name} has access to ${accessibleSystemsData.length} of the ${systemsData.length} systems`
        );

        // Check if we have more pages - only if the full page was returned and the user has access to all of them
       /* setHasMorePages(
          systemsData.length === SYSTEMS_PER_PAGE &&
            accessibleSystemsData.length > 0
        );
        */
       
       setHasMorePages(accessibleSystemsData.length > (page + 1) * SYSTEMS_PER_PAGE);

        // Create an array to hold system metadata for this page
        const enhancedSystems = await Promise.all(
          displayData.map(async (system) => {
            let flowData: api.FlowDataResponse | null = null;
            let aggrToday: api.AggregatedDataResponse | null = null;
            let errorMessages: SystemMessage[] = [];

            try {
              // Fetch flow data for current power and status
              console.log('inside loop')
              flowData = await api.getPvSystemFlowData(system.pvSystemId);

              // Fetch aggregated data for today's energy production
              aggrToday = await api.getPvSystemAggregatedData(system.pvSystemId, {
                from: getShortDateString(new Date()),
                duration: 1,
              });

              // Fetch error messages from the last 24 hours
              try {
                const fromDate = new Date();
                fromDate.setDate(fromDate.getDate() - 1); // Go back 1 day

                // Use the correctly formatted date string
                const formattedFromDate = formatApiDateString(fromDate);

                errorMessages = await api.getPvSystemMessages(system.pvSystemId, {
                  from: formattedFromDate,
                  stateseverity: "Error",
                  limit: 5, // Limit to the most recent 5 errors
                });

                if (errorMessages.length > 0) {
                  console.log(
                    `System ${system.pvSystemId} has ${errorMessages.length} error messages`
                  );
                }
              } catch (msgErr) {
                console.warn(
                  `Failed to fetch error messages for ${system.pvSystemId}:`,
                  msgErr
                );
              }

              // Format system data with flow data, aggregated data, and error messages
              return formatPvSystemData(
                system,
                flowData,
                aggrToday,
                errorMessages
              );
            } catch (err) {
              console.error(
                `Error fetching data for system ${system.pvSystemId}:`,
                err
              );
              // Return basic system data without flow data
              return formatPvSystemData(
                system,
                flowData,
                aggrToday,
                errorMessages
              );
            }
          })
        );

        // Sort by status (active first) then by name
        const sortedSystems = enhancedSystems.sort((a, b) => {
          // Sort active systems first
          if (a.isActive && !b.isActive) return -1;
          if (!a.isActive && b.isActive) return 1;

          // Then sort alphabetically by name
          return a.name.localeCompare(b.name);
        });

        // Update state with loaded systems
        setPvSystems((prevSystems) =>
          page === 0 ? sortedSystems : [...prevSystems, ...sortedSystems]
        );

        if (searchQuery.trim()) {
          applySearchFilter(searchQuery);
        } else {
          setFilteredSystems((prevSystems) =>
            page === 0 ? sortedSystems : [...prevSystems, ...sortedSystems]
          );
        }

        setCurrentPage(page);
        setLoading(false);
        setIsLoadingMore(false);
    }
    } catch (error) {
      console.error("Error loading PV systems:", error);
      setError("Failed to load PV systems. Please try again.");
      setLoading(false);
      setIsLoadingMore(false);
    }
  };

  // Load more systems when reaching end of list
  const handleLoadMore = () => {
    if (!isLoadingMore && hasMorePages && !searchQuery.trim()) {
      loadPvSystemsPage(currentPage + 1, false);
    }
  };

  // Refresh handler
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setCurrentPage(0);
   // setHasMorePages(true);
    loadPvSystemsPage(0, false).finally(() => {
      setRefreshing(false);
    });
  }, []);

  const navigateToDetail = (pvSystemId: string) => {
    router.push(`/pv-detail/${pvSystemId}`);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "online":
        return "#4CAF50"; // Green
      case "warning":
        return "#FF9800"; // Amber/Orange
      case "offline":
        return "#F44336"; // Red
      default:
        return "#9E9E9E"; // Grey
    }
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
            demoMode && { borderWidth: 1, borderColor: "#FF9800" },
          ]}
          onPress={() => navigateToDetail(item.id)}
          onLongPress={() => {
            if (demoMode) {
              console.log(`Long press detected on system ${item.id}`);
              cycleDemoStatus(item.id);
            }
          }}
          delayLongPress={500}
        >
          {demoMode && (
            <View style={styles.demoIndicator}>
              <Text style={styles.demoText}>Long press to change status</Text>
            </View>
          )}
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
                      {item.status === "warning" && (
                        <Ionicons
                          name="warning"
                          size={16}
                          color="#FF9800"
                          style={styles.warningIcon}
                        />
                      )}
                      <StatusIcon
                        systemId={item.id}
                      />
                    </View>
                  </View>
                </View>

                <Text
                  variant="bodySmall"
                  style={{ color: colors.text, opacity: 0.7, marginBottom: 4 }}
                >
                  {item.address}
                </Text>

                {item.peakPower && (
                  <Text
                    variant="bodySmall"
                    style={{
                      color: colors.text,
                      opacity: 0.7,
                      marginBottom: 8,
                    }}
                  >
                    Peak Power: {item.peakPower / 1000} kWp
                  </Text>
                )}
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

  // Render the footer with load more button or loading indicator
  const renderFooter = () => {
    // Don't show pagination controls when in search mode
    if (searchQuery.trim()) {
      return (
        <View style={styles.footerMessage}>
          <Text style={[styles.footerText, { color: colors.text }]}>
            End of search results
          </Text>
          {searchQuery && filteredSystems.length > 0 && (
            <Text
              style={[
                styles.footerTextSmall,
                { color: colors.text, opacity: 0.6 },
              ]}
            >
              Showing up to 20 matching systems
            </Text>
          )}
        </View>
      );
    }

    if (isLoadingMore) {
      return (
        <View style={styles.footerLoading}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.footerText, { color: colors.text }]}>
            Loading more systems...
          </Text>
        </View>
      );
    }

    if (!hasMorePages && pvSystems.length > 0) {
      return (
        <View style={styles.footerMessage}>
          <Text style={[styles.footerText, { color: colors.text }]}>
            No more systems to load
          </Text>
        </View>
      );
    }

    if (hasMorePages && !searchQuery.trim()) {
      return (
        <TouchableOpacity
          style={[styles.loadMoreButton, { backgroundColor: colors.primary }]}
          onPress={handleLoadMore}
        >
          <Text style={styles.loadMoreButtonText}>Load More</Text>
        </TouchableOpacity>
      );
    }

    return null;
  };

  // Update the toggleDemoMode function to use AsyncStorage
  const toggleDemoMode = async () => {
    const newDemoMode = !demoMode;
    setDemoMode(newDemoMode);

    // Store demo mode setting for other screens
    try {
      await AsyncStorage.setItem("demo_mode", newDemoMode.toString());
      console.log(`Demo mode ${newDemoMode ? "enabled" : "disabled"}`);
    } catch (error) {
      console.error("Error saving demo mode state:", error);
    }
  };

  // Add an effect to check for demo mode on initial load
  useEffect(() => {
    const checkDemoMode = async () => {
      try {
        const demoModeValue = await AsyncStorage.getItem("demo_mode");
        if (demoModeValue !== null) {
          setDemoMode(demoModeValue === "true");
        }
      } catch (error) {
        console.error("Error retrieving demo mode state:", error);
      }
    };

    checkDemoMode();
  }, []);

  // Add a function to cycle through status states for a system in demo mode
  const cycleDemoStatus = (systemId: string) => {
    setPvSystems((prevSystems) => {
      const updatedSystems = prevSystems.map((system) => {
        if (system.id === systemId) {
          // Cycle through states: online -> warning -> offline -> online
          let newStatus: "online" | "warning" | "offline";
          if (system.status === "online") newStatus = "warning";
          else if (system.status === "warning") newStatus = "offline";
          else newStatus = "online";

          console.log(
            `Demo: Changed system ${system.name} status to ${newStatus}`
          );

          // If switching to warning state, add a mock error message
          const mockErrorMessages =
            newStatus === "warning"
              ? [
                  {
                    pvSystemId: system.id,
                    deviceId: "demo-device-001",
                    stateType: "Error",
                    stateSeverity: "Error",
                    stateCode: 567,
                    logDateTime: new Date().toISOString(),
                    text: "Demo Error: Inverter communication timeout",
                  },
                ]
              : [];

          return {
            ...system,
            status: newStatus,
            isActive: newStatus !== "offline",
            errorMessages: mockErrorMessages,
          };
        }
        return system;
      });

      // Also update the filtered systems state
      setFilteredSystems((currentFiltered) => {
        return currentFiltered.map((system) => {
          const updatedSystem = updatedSystems.find((s) => s.id === system.id);
          return updatedSystem || system;
        });
      });

      return updatedSystems;
    });
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
          {demoMode && (
            <Text
              variant="titleSmall"
              style={{ color: "#FF9800", fontWeight: "400" }}
            >
              {" "}
              (Demo Mode)
            </Text>
          )}
          {currentUser &&
            currentUser.role !== "admin" &&
            accessibleSystemIds.length > 0 && (
              <Text
                variant="titleSmall"
                style={{ color: colors.primary, fontWeight: "400" }}
              >
                {" "}
                (Temp Access v2.0.0)
              </Text>
            )}
            {currentUser &&
            currentUser.role == "admin" &&
            accessibleSystemIds.length > 0 && (
              <Text
                variant="titleSmall"
                style={{ color: colors.primary, fontWeight: "400" }}
              >
                {" "}
                (v2.0.0)
              </Text>
            )}
        </Text>
        <View style={styles.headerButtons}>
          {/* Demo Mode Toggle Button */}
          <IconButton
            icon={demoMode ? "bug" : "bug-outline"}
            iconColor={demoMode ? "#FF9800" : colors.primary}
            size={24}
            onPress={toggleDemoMode}
            style={{ marginRight: -8 }}
          />
          <IconButton
            icon="refresh"
            iconColor={colors.primary}
            size={24}
            onPress={onRefresh}
            disabled={refreshing}
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
        {isLoadingAllSystems && (
          <ActivityIndicator
            size="small"
            color={colors.primary}
            style={styles.searchLoadingIndicator}
          />
        )}
      </View>

      {/* Results Count */}
      <View style={styles.resultsCountContainer}>
        <Text
          style={[styles.resultsCount, { color: colors.text, opacity: 0.6 }]}
        >
          {filteredSystems.length} systems found
          {searchQuery &&
            allSystemsBasicInfo.length > 0 &&
            ` (searching across ${allSystemsBasicInfo.length} systems)`}
        </Text>
        {isSearching && (
          <ActivityIndicator
            size="small"
            color={colors.primary}
            style={styles.resultsLoadingIndicator}
          />
        )}
      </View>

      {/* Summary Status Icon - positioned below systems found text */}
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
          data={filteredSystems}
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
                No systems found matching your search.
              </Text>
              <TouchableOpacity
                style={styles.clearSearchButton}
                onPress={() => setSearchQuery("")}
              >
                <Text style={{ color: colors.primary }}>Clear Search</Text>
              </TouchableOpacity>
            </View>
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={renderFooter}
        />
      )}
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
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
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
  resultsLoadingIndicator: {
    marginLeft: 8,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 100, // Extra padding at bottom for tab bar
  },
  card: {
    marginBottom: 16,
    borderRadius: 12,
    overflow: "hidden",
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
  statusChip: {
    height: 30,
    borderRadius: 16,
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
  footerLoading: {
    padding: 16,
    alignItems: "center",
  },
  footerText: {
    marginTop: 8,
    fontSize: 14,
    color: "#888",
  },
  footerMessage: {
    padding: 16,
    alignItems: "center",
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
  searchLoadingIndicator: {
    marginLeft: 8,
  },
  footerTextSmall: {
    marginTop: 8,
    fontSize: 12,
    color: "#888",
  },
  warningIcon: {
    marginRight: 8,
  },
  demoIndicator: {
    position: "absolute",
    top: 0,
    right: 0,
    backgroundColor: "#FF9800",
    borderBottomLeftRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    zIndex: 10,
  },
  demoText: {
    color: "white",
    fontSize: 10,
    fontWeight: "bold",
  },
  headerButtons: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardContentContainer: {
    paddingTop: 12,
  },
  summaryStatusContainer: {
    marginBottom: 8,
    alignItems: "center",
  },
});

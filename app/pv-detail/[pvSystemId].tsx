// File: app/pv-detail/[pvSystemId].tsx

import React, { useEffect, useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  Image,
  ActivityIndicator,
  ScrollView,
  FlatList,
  Linking,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import * as api from "@/api/api";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import Animated, { FadeInUp, FadeInDown } from "react-native-reanimated";
import { Card, Divider, Chip, Button } from "react-native-paper";
import { getCurrentUser, hasSystemAccess } from "@/utils/auth";

const findChannelValue = (
  channels:
    | api.FlowDataChannel[]
    | api.AggregatedDataChannel[]
    | api.WeatherChannel[]
    | undefined,
  channelName: string
): any | null => {
  return channels?.find((c) => c.channelName === channelName)?.value ?? null;
};

const formatDateTime = (isoString: string | null | undefined): string => {
  if (!isoString) return "N/A";
  try {
    return new Date(isoString).toLocaleString();
  } catch (e) {
    return "Invalid Date";
  }
};
const formatDate = (isoString: string | null | undefined): string => {
  if (!isoString) return "N/A";
  try {
    return new Date(isoString).toLocaleDateString();
  } catch (e) {
    return "Invalid Date";
  }
};

export default function PvSystemDetailScreen() {
  const { pvSystemId } = useLocalSearchParams<{ pvSystemId?: string }>();
  const router = useRouter();
  const { isDarkMode, colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);

  // State for all fetched data
  const [pvSystemDetails, setPvSystemDetails] =
    useState<api.PvSystemMetadata | null>(null);
  const [flowData, setFlowData] = useState<api.FlowDataResponse | null>(null);
  const [aggregatedDataToday, setAggregatedDataToday] =
    useState<api.AggregatedDataResponse | null>(null);
  const [aggregatedDataTotal, setAggregatedDataTotal] =
    useState<api.AggregatedDataResponse | null>(null);
  const [weatherData, setWeatherData] =
    useState<api.CurrentWeatherResponse | null>(null);
  const [messages, setMessages] = useState<api.SystemMessage[]>([]);
  const [devices, setDevices] = useState<api.DeviceMetadata[]>([]);

  // Combined loading and error states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check if user has access to this system
  useEffect(() => {
    const checkAccess = async () => {
      try {
        setCheckingAccess(true);
        if (!pvSystemId) return;

        const user = await getCurrentUser();
        if (!user) {
          setHasAccess(false);
          router.replace("/"); // Redirect to login if not authenticated
          return;
        }

        setIsAdmin(user.role === "admin");
        const access = hasSystemAccess(user.id, pvSystemId as string);
        setHasAccess(access);

        if (!access) {
          setLoading(false);
        }
      } catch (error) {
        console.error("Error checking access:", error);
        setHasAccess(false);
      } finally {
        setCheckingAccess(false);
      }
    };

    checkAccess();
  }, [pvSystemId, router]);

  // --- Date Helpers ---
  const getShortDateString = (date: Date): string => {
    return date.toISOString().split("T")[0]; // YYYY-MM-DD
  };
  const getIsoDateString = (date: Date): string => {
    return date.toISOString().split(".")[0] + "Z"; // YYYY-MM-DDTHH:mm:ssZ
  };

  const fetchAllData = async () => {
    if (hasAccess === false) return;

    setLoading(true);
    setError(null);
    console.log(`Fetching all data for system: ${pvSystemId}`);

    try {
      if (!pvSystemId || typeof pvSystemId !== "string") {
        throw new Error("Invalid or missing PV System ID");
      }

      const [details, flow, aggrToday, aggrTotal, weather, devs] =
        await Promise.allSettled([
          api.getPvSystemDetails(pvSystemId),
          api.getPvSystemFlowData(pvSystemId),
          api.getPvSystemAggregatedData(pvSystemId, {
            from: getShortDateString(new Date()),
            duration: 1,
          }),
          api.getPvSystemAggregatedData(pvSystemId, {
            period: "total",
            channel: "SavingsCO2",
          }),
          api.getCurrentWeather(pvSystemId),
          api.getPvSystemDevices(pvSystemId),
        ]);

      // Set State based on results
      if (details.status === "fulfilled") setPvSystemDetails(details.value);
      else {
        console.error("Failed Details:", details.reason);
        throw details.reason;
      } // Throw if essential details fail

      if (flow.status === "fulfilled") setFlowData(flow.value);
      else console.error("Failed Flow:", flow.reason);

      if (aggrToday.status === "fulfilled")
        setAggregatedDataToday(aggrToday.value);
      else console.error("Failed Aggr Today:", aggrToday.reason);

      if (aggrTotal.status === "fulfilled")
        setAggregatedDataTotal(aggrTotal.value);
      else console.error("Failed Aggr Total:", aggrTotal.reason);

      if (weather.status === "fulfilled") setWeatherData(weather.value);
      else console.error("Failed Weather:", weather.reason);

      if (devs.status === "fulfilled")
        setDevices(devs.value ?? []); // Default to empty array if null
      else console.error("Failed Devices:", devs.reason);
    } catch (err) {
      console.error("Error fetching PV system data:", err);
      setError(
        `Failed to load system data: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (checkingAccess) return;

    if (hasAccess === false) {
      setLoading(false);
      return;
    }

    if (!pvSystemId || typeof pvSystemId !== "string") {
      // Type check pvSystemId
      setError("Invalid or missing PV System ID.");
      setLoading(false);
      return;
    }

    fetchAllData();
  }, [pvSystemId, hasAccess, checkingAccess]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchAllData();
  };

  // --- Access Denied State ---
  if (hasAccess === false && !checkingAccess) {
    return (
      <SafeAreaView
        style={[
          styles.safeArea,
          { backgroundColor: isDarkMode ? colors.background : "#f5f5f5" },
        ]}
        edges={["top", "left", "right"]}
      >
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButtonContainer}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: "600" }}>
            Access Denied
          </Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.centered}>
          <Ionicons name="lock-closed" size={70} color="#f44336" />
          <ThemedText style={[styles.errorText, { marginTop: 20 }]}>
            You don't have access to this PV system.
          </ThemedText>
          <Text
            style={[
              styles.accessDeniedSubtext,
              { marginTop: 10, color: isDarkMode ? "#aaa" : "#666" },
            ]}
          >
            System ID: {pvSystemId}
          </Text>
          <Button
            mode="contained"
            onPress={() => router.back()}
            style={{ marginTop: 20 }}
          >
            Go Back
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  // --- Loading State ---
  if ((loading && !refreshing) || checkingAccess) {
    return (
      <SafeAreaView
        style={[
          styles.safeArea,
          { backgroundColor: isDarkMode ? colors.background : "#f5f5f5" },
        ]}
        edges={["top", "left", "right"]}
      >
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <ThemedText style={styles.loadingText}>
            {checkingAccess
              ? "Checking access..."
              : "Loading System Dashboard..."}
          </ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  // --- Error State ---
  if (error) {
    return (
      <SafeAreaView
        style={[
          styles.safeArea,
          { backgroundColor: isDarkMode ? colors.background : "#f5f5f5" },
        ]}
        edges={["top", "left", "right"]}
      >
        <View style={styles.centered}>
          <ThemedText style={styles.errorText}>{error}</ThemedText>
          <TouchableOpacity
            style={[
              styles.retryButton,
              { backgroundColor: colors.primary + "20" },
            ]}
            onPress={onRefresh}
          >
            <ThemedText style={{ color: colors.primary }}>Retry</ThemedText>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // --- No Data State ---
  if (!pvSystemDetails) {
    return (
      <SafeAreaView
        style={[
          styles.safeArea,
          { backgroundColor: isDarkMode ? colors.background : "#f5f5f5" },
        ]}
        edges={["top", "left", "right"]}
      >
        <View style={styles.centered}>
          <ThemedText style={styles.errorText}>
            No PV system data could be loaded.
          </ThemedText>
          <TouchableOpacity
            style={[
              styles.retryButton,
              { backgroundColor: colors.primary + "20" },
            ]}
            onPress={onRefresh}
          >
            <ThemedText style={{ color: colors.primary }}>Retry</ThemedText>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // --- Extract Key Data Points (with null checks) ---
  const currentPowerOutput = findChannelValue(
    flowData?.data?.channels,
    "PowerPV"
  );
  const dailyEnergyProduction = findChannelValue(
    aggregatedDataToday?.data?.[0]?.channels,
    "EnergyProductionTotal"
  );
  const totalCo2Savings = findChannelValue(
    aggregatedDataTotal?.data?.[0]?.channels,
    "SavingsCO2"
  );
  const systemIsOnline = flowData?.status?.isOnline ?? false;
  const systemStatusColor = !systemIsOnline ? "#FF3B30" : "#34C759";

  const getWeatherDescription = (symbolCode: string | null): string => {
    if (!symbolCode) return "Unknown";

    const weatherMap: Record<string, string> = {
      "1": "Sunny",
      "2": "Partly Cloudy",
      "3": "Cloudy",
      "4": "Overcast",
      "5": "Fog",
      "6": "Light Rain",
      "7": "Rain",
      "8": "Heavy Rain",
      "9": "Thunderstorm",
      "10": "Light Snow",
      "11": "Snow",
      "12": "Heavy Snow",
      "13": "Sleet",
      // Add more mappings as needed
    };

    return weatherMap[symbolCode] || `Weather code ${symbolCode}`;
  };

  // Weather Widget Component
  const WeatherWidget = () => {
    const getIconName = (iconBaseName: string) => {
      return iconBaseName as keyof typeof Ionicons.glyphMap;
    };

    if (!weatherData || !weatherData.data) {
      return (
        <Animated.View
          entering={FadeInUp.delay(200).springify()}
          style={[
            styles.weatherCard,
            { backgroundColor: isDarkMode ? colors.card : "#fff" },
          ]}
        >
          <ThemedText style={styles.sectionTitle}>Current Weather</ThemedText>
          <View style={styles.weatherNoDataContent}>
            <Ionicons
              name="cloudy-outline"
              size={48}
              color={isDarkMode ? "#888" : "#aaaaaa"}
            />
            <ThemedText style={[styles.infoValue, { marginTop: 12 }]}>
              Weather data unavailable for this system
            </ThemedText>
            <ThemedText style={styles.weatherUpdated}>
              Weather data may require a premium subscription
            </ThemedText>
          </View>
        </Animated.View>
      );
    }

    const weatherSymbol = findChannelValue(weatherData.data.channels, "Symbol");
    const temperature = findChannelValue(weatherData.data.channels, "Temp");
    const humidity = findChannelValue(
      weatherData.data.channels,
      "RelativeHumidity"
    );
    const windSpeed = findChannelValue(weatherData.data.channels, "WindSpeed");

    const getWeatherIcon = (symbol: string | null) => {
      if (!symbol) return "cloudy-outline";

      const iconMap: Record<string, string> = {
        "1": "sunny-outline",
        "2": "partly-sunny-outline",
        "3": "cloud-outline",
        "4": "cloudy-outline",
        "5": "cloud-outline", // Fog
        "6": "rainy-outline", // Light rain
        "7": "rainy-outline", // Rain
        "8": "thunderstorm-outline", // Heavy rain
        "9": "thunderstorm-outline", // Thunderstorm
        "10": "snow-outline", // Light snow
        "11": "snow-outline", // Snow
        "12": "snow-outline", // Heavy snow
        "13": "snow-outline", // Sleet
      };

      return iconMap[symbol] || "cloudy-outline";
    };

    return (
      <Animated.View
        entering={FadeInUp.delay(200).springify()}
        style={[
          styles.weatherCard,
          { backgroundColor: isDarkMode ? colors.card : "#fff" },
        ]}
      >
        <ThemedText style={styles.sectionTitle}>Current Weather</ThemedText>

        <View style={styles.weatherMainContent}>
          <View style={styles.weatherIconContainer}>
            <Ionicons
              name={getIconName(getWeatherIcon(weatherSymbol))}
              size={64}
              color={colors.primary}
            />
          </View>

          <View style={styles.weatherDataContainer}>
            <ThemedText style={styles.weatherTemperature}>
              {temperature !== null ? `${temperature.toFixed(1)}°C` : "--°C"}
            </ThemedText>
            <ThemedText style={styles.weatherCondition}>
              {getWeatherDescription(weatherSymbol)}
            </ThemedText>

            <View style={styles.weatherDetails}>
              <View style={styles.weatherDetailItem}>
                <Ionicons
                  name="water-outline"
                  size={16}
                  color={colors.primary}
                />
                <ThemedText style={styles.weatherDetailText}>
                  {humidity !== null ? `${humidity.toFixed(0)}%` : "--"}
                </ThemedText>
              </View>

              <View style={styles.weatherDetailItem}>
                <Ionicons
                  name="speedometer-outline"
                  size={16}
                  color={colors.primary}
                />
                <ThemedText style={styles.weatherDetailText}>
                  {windSpeed !== null ? `${windSpeed.toFixed(1)} km/h` : "--"}
                </ThemedText>
              </View>
            </View>
          </View>
        </View>

        <ThemedText style={styles.weatherUpdated}>
          Last updated: {formatDateTime(weatherData.data.logDateTime)}
        </ThemedText>
      </Animated.View>
    );
  };

  // Device Card Component
  const DeviceCard = ({
    device,
    index,
  }: {
    device: api.DeviceMetadata;
    index: number;
  }) => {
    const systemIdParam =
      pvSystemId && typeof pvSystemId === "string" ? pvSystemId : "";

    return (
      <Animated.View
        entering={FadeInUp.delay(300 + index * 100).springify()}
        style={styles.deviceCardContainer}
      >
        <Card
          style={[
            styles.deviceCard,
            { backgroundColor: isDarkMode ? colors.card : "#fff" },
          ]}
          onPress={() => {
            Alert.alert(
              "View Device Details",
              `Would navigate to details for ${
                device.deviceName || device.deviceType
              } (ID: ${device.deviceId})`,
              [{ text: "OK" }]
            );
          }}
        >
          <Card.Content>
            <View style={styles.deviceHeader}>
              <View style={styles.deviceNameContainer}>
                <ThemedText
                  style={styles.deviceName}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {device.deviceName || `(${device.deviceType})`}
                </ThemedText>
                <Chip
                  style={[
                    styles.deviceStatusChip,
                    {
                      backgroundColor: device.isActive
                        ? "#34C759" + "22"
                        : "#FF3B30" + "22",
                    },
                  ]}
                  textStyle={{
                    color: device.isActive ? "#34C759" : "#FF3B30",
                    fontWeight: "600",
                    fontSize: 12,
                  }}
                >
                  {device.isActive ? "ACTIVE" : "INACTIVE"}
                </Chip>
              </View>
            </View>

            <ThemedText style={styles.deviceType} numberOfLines={1}>
              Type: {device.deviceType}
            </ThemedText>

            <ThemedText style={styles.deviceDate} numberOfLines={1}>
              Installed: {formatDate(device.activationDate)}
            </ThemedText>

            <Divider style={{ marginVertical: 12 }} />

            <View style={styles.deviceFooter}>
              <ThemedText style={styles.deviceViewDetails}>
                View Details
              </ThemedText>
              <Ionicons
                name="chevron-forward"
                size={16}
                color={colors.primary}
              />
            </View>
          </Card.Content>
        </Card>
      </Animated.View>
    );
  };

  // --- Render Dashboard ---
  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        { backgroundColor: isDarkMode ? colors.background : "#f5f5f5" },
      ]}
      edges={["top", "left", "right"]}
    >
      {/* Configure Header Title Dynamically */}
      <Stack.Screen
        options={{
          title: pvSystemDetails.name || "System Details",
          headerStyle: {
            backgroundColor: isDarkMode ? colors.background : "#f5f5f5",
          },
          headerShadowVisible: false,
          headerTintColor: colors.text,
        }}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* --- Header --- */}
        <Animated.View entering={FadeInDown.springify()}>
          <View style={styles.header}>
            <View style={styles.statusContainer}>
              <View
                style={[
                  styles.statusIndicator,
                  { backgroundColor: systemStatusColor },
                ]}
              />
              <ThemedText style={styles.statusText}>
                {systemIsOnline ? "Online" : "Offline"}
              </ThemedText>
            </View>
          </View>

          {/* --- Image --- */}
          <View style={styles.imageContainer}>
            {pvSystemDetails.pictureURL ? (
              <Image
                source={{ uri: pvSystemDetails.pictureURL }}
                style={styles.image}
                contentFit="cover"
              />
            ) : (
              <View
                style={[
                  styles.placeholderImage,
                  { backgroundColor: isDarkMode ? colors.card : "#e0e0e0" },
                ]}
              >
                <Ionicons
                  name="image-outline"
                  size={64}
                  color={isDarkMode ? "#555" : "#999"}
                />
              </View>
            )}
          </View>
        </Animated.View>

        {/* --- System Dashboard Section --- */}
        <Animated.View
          entering={FadeInUp.delay(100).springify()}
          style={[
            styles.section,
            { backgroundColor: isDarkMode ? colors.card : "#fff" },
          ]}
        >
          <ThemedText style={styles.sectionTitle}>System Dashboard</ThemedText>

          {/* KPIs */}
          <View style={styles.kpiContainer}>
            <View
              style={[
                styles.kpiItem,
                { backgroundColor: isDarkMode ? colors.background : "#f8f8f8" },
              ]}
            >
              <ThemedText style={styles.kpiLabel}>Current Power</ThemedText>
              <ThemedText style={[styles.kpiValue, { color: colors.primary }]}>
                {currentPowerOutput !== null
                  ? (currentPowerOutput / 1000).toFixed(2)
                  : "N/A"}{" "}
                kW
              </ThemedText>
            </View>
            <View
              style={[
                styles.kpiItem,
                { backgroundColor: isDarkMode ? colors.background : "#f8f8f8" },
              ]}
            >
              <ThemedText style={styles.kpiLabel}>Today's Energy</ThemedText>
              <ThemedText style={[styles.kpiValue, { color: colors.primary }]}>
                {dailyEnergyProduction !== null
                  ? (dailyEnergyProduction / 1000).toFixed(2)
                  : "N/A"}{" "}
                kWh
              </ThemedText>
            </View>
            <View
              style={[
                styles.kpiItem,
                { backgroundColor: isDarkMode ? colors.background : "#f8f8f8" },
              ]}
            >
              <ThemedText style={styles.kpiLabel}>Total CO₂ Saved</ThemedText>
              <ThemedText style={[styles.kpiValue, { color: colors.primary }]}>
                {totalCo2Savings !== null ? totalCo2Savings.toFixed(1) : "N/A"}{" "}
                kg
              </ThemedText>
            </View>
            <View
              style={[
                styles.kpiItem,
                { backgroundColor: isDarkMode ? colors.background : "#f8f8f8" },
              ]}
            >
              <ThemedText style={styles.kpiLabel}>Peak Power</ThemedText>
              <ThemedText style={[styles.kpiValue, { color: colors.primary }]}>
                {pvSystemDetails.peakPower
                  ? `${(pvSystemDetails.peakPower / 1000).toFixed(2)}`
                  : "N/A"}{" "}
                kWp
              </ThemedText>
            </View>
          </View>
        </Animated.View>

        {/* Weather Widget */}
        <WeatherWidget />

        {/* --- Devices Section --- */}
        <Animated.View
          entering={FadeInUp.delay(300).springify()}
          style={[
            styles.section,
            { backgroundColor: isDarkMode ? colors.card : "#fff" },
          ]}
        >
          <View style={styles.sectionHeader}>
            <ThemedText style={styles.sectionTitle}>Devices</ThemedText>
            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  "View All Devices",
                  `Would navigate to all devices for ${
                    pvSystemDetails?.name || "this system"
                  }`,
                  [{ text: "OK" }]
                );
              }}
              style={styles.viewAllButton}
            >
              <ThemedText style={{ color: colors.primary }}>
                View All
              </ThemedText>
              <Ionicons
                name="chevron-forward"
                size={14}
                color={colors.primary}
              />
            </TouchableOpacity>
          </View>

          {devices.length > 0 ? (
            <View>
              {devices.slice(0, 3).map((device, index) => (
                <DeviceCard
                  key={device.deviceId}
                  device={device}
                  index={index}
                />
              ))}

              {devices.length > 3 && (
                <ThemedText style={styles.moreDevicesText}>
                  {devices.length - 3} more devices available
                </ThemedText>
              )}
            </View>
          ) : (
            <ThemedText style={styles.noDataText}>
              No devices found for this system.
            </ThemedText>
          )}
        </Animated.View>

        {/* --- Maintenance Log Section --- */}
        <Animated.View
          entering={FadeInUp.delay(400).springify()}
          style={[
            styles.section,
            { backgroundColor: isDarkMode ? colors.card : "#fff" },
          ]}
        >
          <ThemedText style={styles.sectionTitle}>Maintenance Log</ThemedText>
          <ThemedText style={styles.noDataText}>
            Maintenance logs are not available for this system at the moment.
          </ThemedText>
        </Animated.View>

        {/* --- Basic System Info Section --- */}
        <Animated.View
          entering={FadeInUp.delay(500).springify()}
          style={[
            styles.section,
            { backgroundColor: isDarkMode ? colors.card : "#fff" },
          ]}
        >
          <ThemedText style={styles.sectionTitle}>
            System Information
          </ThemedText>
          <View style={styles.infoItem}>
            <ThemedText style={styles.infoLabel}>ID:</ThemedText>
            <ThemedText style={styles.infoValue}>
              {pvSystemDetails.pvSystemId}
            </ThemedText>
          </View>
          <View style={styles.infoItem}>
            <ThemedText style={styles.infoLabel}>Installation:</ThemedText>
            <ThemedText style={styles.infoValue}>
              {formatDate(pvSystemDetails.installationDate)}
            </ThemedText>
          </View>
          <View style={styles.infoItem}>
            <ThemedText style={styles.infoLabel}>Last Import:</ThemedText>
            <ThemedText style={styles.infoValue}>
              {formatDateTime(pvSystemDetails.lastImport)}
            </ThemedText>
          </View>
          <View style={styles.infoItem}>
            <ThemedText style={styles.infoLabel}>Time Zone:</ThemedText>
            <ThemedText style={styles.infoValue}>
              {pvSystemDetails.timeZone}
            </ThemedText>
          </View>
        </Animated.View>

        {/* --- Location Section --- */}
        <Animated.View
          entering={FadeInUp.delay(600).springify()}
          style={[
            styles.section,
            { backgroundColor: isDarkMode ? colors.card : "#fff" },
          ]}
        >
          <ThemedText style={styles.sectionTitle}>Location</ThemedText>
          <View style={styles.infoItem}>
            <ThemedText style={styles.infoLabel}>Street:</ThemedText>
            <ThemedText style={styles.infoValue}>
              {pvSystemDetails.address.street ?? "N/A"}
            </ThemedText>
          </View>
          <View style={styles.infoItem}>
            <ThemedText style={styles.infoLabel}>City:</ThemedText>
            <ThemedText style={styles.infoValue}>
              {pvSystemDetails.address.city ?? "N/A"}
            </ThemedText>
          </View>
          <View style={styles.infoItem}>
            <ThemedText style={styles.infoLabel}>Zip Code:</ThemedText>
            <ThemedText style={styles.infoValue}>
              {pvSystemDetails.address.zipCode ?? "N/A"}
            </ThemedText>
          </View>
          <View style={styles.infoItem}>
            <ThemedText style={styles.infoLabel}>State:</ThemedText>
            <ThemedText style={styles.infoValue}>
              {pvSystemDetails.address.state ?? "N/A"}
            </ThemedText>
          </View>
          <View style={styles.infoItem}>
            <ThemedText style={styles.infoLabel}>Country:</ThemedText>
            <ThemedText style={styles.infoValue}>
              {pvSystemDetails.address.country ?? "N/A"}
            </ThemedText>
          </View>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

// --- Styles (Combined and refined from previous examples) ---
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  statusContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.05)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  statusIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  statusText: {
    fontSize: 14,
    fontWeight: "600",
  },
  imageContainer: {
    height: 200,
    borderRadius: 12,
    overflow: "hidden",
    marginHorizontal: 16,
    marginBottom: 16,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  placeholderImage: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  section: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    // Shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  weatherCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    // Shadow
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  viewAllButton: {
    flexDirection: "row",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 12,
  },
  kpiContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  kpiItem: {
    width: "48%",
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginBottom: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  kpiLabel: {
    fontSize: 13,
    marginBottom: 4,
    opacity: 0.7,
    textAlign: "center",
  },
  kpiValue: {
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
  },
  weatherMainContent: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  weatherNoDataContent: {
    alignItems: "center",
    padding: 24,
  },
  weatherIconContainer: {
    marginRight: 16,
  },
  weatherDataContainer: {
    flex: 1,
  },
  weatherTemperature: {
    fontSize: 28,
    fontWeight: "bold",
  },
  weatherCondition: {
    fontSize: 16,
    opacity: 0.7,
    marginBottom: 8,
  },
  weatherDetails: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  weatherDetailItem: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 16,
    marginBottom: 4,
  },
  weatherDetailText: {
    marginLeft: 6,
    opacity: 0.7,
  },
  weatherUpdated: {
    fontSize: 12,
    opacity: 0.5,
    textAlign: "right",
    marginTop: 8,
  },
  deviceCardContainer: {
    marginBottom: 12,
  },
  deviceCard: {
    borderRadius: 10,
    overflow: "hidden",
  },
  deviceHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  deviceNameContainer: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  deviceName: {
    fontWeight: "bold",
    fontSize: 16,
    marginRight: 8,
    flex: 1,
  },
  deviceStatusChip: {
    height: 26,
    borderRadius: 13,
  },
  deviceType: {
    opacity: 0.7,
    fontSize: 14,
    marginBottom: 4,
  },
  deviceDate: {
    opacity: 0.7,
    fontSize: 14,
  },
  deviceFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  deviceViewDetails: {
    fontSize: 14,
    marginRight: 4,
    opacity: 0.8,
  },
  moreDevicesText: {
    textAlign: "center",
    opacity: 0.6,
    marginTop: 8,
    fontSize: 14,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    opacity: 0.7,
  },
  errorText: {
    fontSize: 16,
    color: "#FF3B30",
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  infoItem: {
    flexDirection: "row",
    marginBottom: 10,
  },
  infoLabel: {
    fontWeight: "600",
    width: 110,
    opacity: 0.8,
  },
  infoValue: {
    flex: 1,
    opacity: 0.7,
  },
  noDataText: {
    opacity: 0.7,
    textAlign: "center",
    paddingVertical: 16,
  },
  backButtonContainer: {
    padding: 8,
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  accessDeniedSubtext: {
    fontSize: 14,
    textAlign: "center",
  },
});

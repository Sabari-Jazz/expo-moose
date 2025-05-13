import React, { useEffect, useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  Image,
  ActivityIndicator,
  Alert,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as api from "@/api/api";
import { ThemedView } from "./ThemedView";
import { ThemedText } from "./ThemedText";
import { useThemeColor } from "@/hooks/useThemeColor";
import { Stack } from "expo-router";
import { LocalIonicon } from "./ui/LocalIonicon";

// Helper to find a specific channel value
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

// Helper to format date/time
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

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const primaryColor = useThemeColor({}, "tint");
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");
  const borderColor = useThemeColor({}, "border");
  const cardColor = useThemeColor({}, "cardBackground");

  // Custom status colors
  const statusColors = {
    online: "#4CAF50", // Green
    warning: "#FF9800", // Orange
    offline: "#F44336", // Red
  };

  // --- Date Helpers ---
  const getShortDateString = (date: Date): string => {
    return date.toISOString().split("T")[0]; // YYYY-MM-DD
  };
  const getIsoDateString = (date: Date): string => {
    return date.toISOString().split(".")[0] + "Z"; // YYYY-MM-DDTHH:mm:ssZ
  };

  useEffect(() => {
    if (!pvSystemId) {
      setError("No PV System ID provided.");
      setLoading(false);
      return;
    }

    const fetchAllData = async () => {
      setLoading(true);
      setError(null);
      console.log(`Fetching all data for system: ${pvSystemId}`);

      try {
        // Fetch all data in parallel where possible
        const [details, flow, aggrToday, aggrTotal, weather, msgs, devs] =
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
            api.getPvSystemMessages(pvSystemId, {
              stateseverity: "Error",
              limit: 10,
              from: getIsoDateString(
                new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) // 30 days ago
              ),
              to: getIsoDateString(new Date()), // Current date/time
            }),
            api.getPvSystemDevices(pvSystemId),
          ]);

        // Process results - handle fulfilled and rejected promises
        if (details.status === "fulfilled") setPvSystemDetails(details.value);
        else console.error("Failed to fetch Details:", details.reason);

        if (flow.status === "fulfilled") setFlowData(flow.value);
        else console.error("Failed to fetch Flow Data:", flow.reason);

        if (aggrToday.status === "fulfilled")
          setAggregatedDataToday(aggrToday.value);
        else
          console.error(
            "Failed to fetch Today's Aggregated Data:",
            aggrToday.reason
          );

        if (aggrTotal.status === "fulfilled")
          setAggregatedDataTotal(aggrTotal.value);
        else
          console.error(
            "Failed to fetch Total Aggregated Data:",
            aggrTotal.reason
          );

        if (weather.status === "fulfilled") setWeatherData(weather.value);
        else console.error("Failed to fetch Weather Data:", weather.reason);

        if (msgs.status === "fulfilled") setMessages(msgs.value);
        else console.error("Failed to fetch Messages:", msgs.reason);

        if (devs.status === "fulfilled") setDevices(devs.value);
        else console.error("Failed to fetch Devices:", devs.reason);

        if (details.status === "rejected") {
          throw details.reason;
        }
      } catch (err) {
        console.error("Error fetching PV system data:", err);
        setError(
          `Failed to load system data: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      } finally {
        setLoading(false);
      }
    };

    fetchAllData();
  }, [pvSystemId]); // Re-fetch if pvSystemId changes

  // --- Render Loading/Error/NoData States ---
  if (loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator size="large" color={primaryColor} />
        <ThemedText type="caption" style={styles.loadingText}>
          Loading System Dashboard...
        </ThemedText>
      </ThemedView>
    );
  }

  if (error) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText type="error" style={styles.errorText}>
          {error}
        </ThemedText>
        <TouchableOpacity
          style={[styles.retryButton, { backgroundColor: primaryColor }]}
          onPress={() => router.replace(`/pv-detail/${pvSystemId}`)}
        >
          <LocalIonicon
            name="refresh"
            variant="-outline"
            size={16}
            color={textColor}
            style={{ marginRight: 8 }}
          />
          <ThemedText style={{ color: textColor }}>Retry</ThemedText>
        </TouchableOpacity>
      </ThemedView>
    );
  }

  if (!pvSystemDetails) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText type="error" style={styles.errorText}>
          No PV system data available.
        </ThemedText>
      </ThemedView>
    );
  }

  // --- Extract Key Data Points ---
  const currentPowerOutput = findChannelValue(
    flowData?.data?.channels,
    "PowerPV"
  ); // Power from PV
  const dailyEnergyProduction = findChannelValue(
    aggregatedDataToday?.data?.[0]?.channels,
    "EnergyProductionTotal"
  );
  const totalCo2Savings = findChannelValue(
    aggregatedDataTotal?.data?.[0]?.channels,
    "SavingsCO2"
  );
  const systemIsOnline = flowData?.status?.isOnline ?? false;
  const latestErrorMessages = messages.filter(
    (m) => m.stateSeverity === "Error"
  );
  const systemStatus = !systemIsOnline
    ? "offline"
    : latestErrorMessages.length > 0
    ? "warning"
    : "online";
  const systemStatusColor = statusColors[systemStatus];

  // --- Render Dashboard ---
  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: backgroundColor }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Configure Header Title Dynamically */}
      <Stack.Screen
        options={{ title: pvSystemDetails.name || "System Details" }}
      />
      <ThemedView
        style={[styles.container, { backgroundColor: "transparent" }]}
      >
        {/* --- Hero Section with Image and Status --- */}
        <ThemedView
          type="card"
          style={[styles.heroContainer, { backgroundColor: cardColor }]}
        >
          <View style={styles.imageOverlay}>
            {pvSystemDetails.pictureURL ? (
              <Image
                source={{ uri: pvSystemDetails.pictureURL }}
                style={styles.heroImage}
                resizeMode="cover"
              />
            ) : (
              <View
                style={[
                  styles.placeholderImage,
                  { backgroundColor: cardColor },
                ]}
              >
                <LocalIonicon
                  name="business"
                  variant="-outline"
                  size={60}
                  color={borderColor}
                />
                <ThemedText type="caption">No Image Available</ThemedText>
              </View>
            )}
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: systemStatusColor },
              ]}
            >
              <ThemedText style={[styles.statusText, { color: textColor }]}>
                {systemStatus === "online"
                  ? "Online"
                  : systemStatus === "warning"
                  ? `Warning (${latestErrorMessages.length})`
                  : "Offline"}
              </ThemedText>
            </View>
          </View>

          <View style={styles.heroContent}>
            <ThemedText type="title" style={styles.title}>
              {pvSystemDetails.name}
            </ThemedText>
            <ThemedText type="caption" style={styles.address}>
              {pvSystemDetails.address?.street}, {pvSystemDetails.address?.city}
              , {pvSystemDetails.address?.country}
            </ThemedText>
          </View>
        </ThemedView>

        {/* --- Key Stats Cards --- */}
        <View style={styles.statsContainer}>
          <View style={styles.statsRow}>
            {/* Power Output Card */}
            <ThemedView
              type="card"
              style={[styles.statCard, { backgroundColor: cardColor }]}
            >
              <LocalIonicon
                name="flash"
                size={24}
                color={primaryColor}
                style={styles.statIcon}
              />
              <ThemedText type="caption" style={styles.statLabel}>
                Current Power
              </ThemedText>
              <ThemedText type="title" style={styles.statValue}>
                {currentPowerOutput !== null
                  ? `${(currentPowerOutput / 1000).toFixed(1)} kW`
                  : "N/A"}
              </ThemedText>
            </ThemedView>

            {/* Daily Energy Card */}
            <ThemedView
              type="card"
              style={[styles.statCard, { backgroundColor: cardColor }]}
            >
              <LocalIonicon
                name="sunny"
                size={24}
                color={primaryColor}
                style={styles.statIcon}
              />
              <ThemedText type="caption" style={styles.statLabel}>
                Today's Energy
              </ThemedText>
              <ThemedText type="title" style={styles.statValue}>
                {dailyEnergyProduction !== null
                  ? `${dailyEnergyProduction.toFixed(1)} kWh`
                  : "N/A"}
              </ThemedText>
            </ThemedView>
          </View>

          <View style={styles.statsRow}>
            {/* CO2 Savings Card */}
            <ThemedView
              type="card"
              style={[styles.statCard, { backgroundColor: cardColor }]}
            >
              <LocalIonicon
                name="leaf"
                size={24}
                color={primaryColor}
                style={styles.statIcon}
              />
              <ThemedText type="caption" style={styles.statLabel}>
                CO₂ Saved
              </ThemedText>
              <ThemedText type="title" style={styles.statValue}>
                {totalCo2Savings !== null
                  ? `${totalCo2Savings.toFixed(0)} kg`
                  : "N/A"}
              </ThemedText>
            </ThemedView>

            {/* Last Updated Card */}
            <ThemedView
              type="card"
              style={[styles.statCard, { backgroundColor: cardColor }]}
            >
              <LocalIonicon
                name="time"
                size={24}
                color={primaryColor}
                style={styles.statIcon}
              />
              <ThemedText type="caption" style={styles.statLabel}>
                Last Updated
              </ThemedText>
              <ThemedText type="caption" style={styles.statTimeValue}>
                {formatDateTime(flowData?.data?.logDateTime)}
              </ThemedText>
            </ThemedView>
          </View>
        </View>

        {/* --- Weather Section --- */}
        <ThemedView
          type="card"
          style={[styles.section, { backgroundColor: cardColor }]}
        >
          <View style={styles.sectionHeader}>
            <LocalIonicon name="partly-sunny" size={24} color={primaryColor} />
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              Weather Conditions
            </ThemedText>
          </View>

          {weatherData?.data?.channels && (
            <View style={styles.weatherStats}>
              <View style={styles.weatherStat}>
                <LocalIonicon
                  name="thermometer"
                  variant="-outline"
                  size={20}
                  color={primaryColor}
                />
                <ThemedText type="body" style={styles.weatherValue}>
                  {findChannelValue(
                    weatherData.data.channels,
                    "Temperature"
                  ) !== null
                    ? `${findChannelValue(
                        weatherData.data.channels,
                        "Temperature"
                      )}°C`
                    : "N/A"}
                </ThemedText>
              </View>

              <View style={styles.weatherStat}>
                <LocalIonicon
                  name="thunderstorm"
                  variant="-outline"
                  size={20}
                  color={primaryColor}
                />
                <ThemedText type="body" style={styles.weatherValue}>
                  {findChannelValue(weatherData.data.channels, "WindSpeed") !==
                  null
                    ? `${findChannelValue(
                        weatherData.data.channels,
                        "WindSpeed"
                      )} m/s`
                    : "N/A"}
                </ThemedText>
              </View>

              <View style={styles.weatherStat}>
                <LocalIonicon name="cloud" size={20} color={primaryColor} />
                <ThemedText type="body" style={styles.weatherValue}>
                  {findChannelValue(weatherData.data.channels, "CloudCover") !==
                  null
                    ? `${findChannelValue(
                        weatherData.data.channels,
                        "CloudCover"
                      )}%`
                    : "N/A"}
                </ThemedText>
              </View>
            </View>
          )}

          {(!weatherData || !weatherData.data?.channels) && (
            <ThemedText type="caption">Weather data not available</ThemedText>
          )}
        </ThemedView>

        {/* --- Devices Section --- */}
        <ThemedView
          type="card"
          style={[styles.section, { backgroundColor: cardColor }]}
        >
          <View style={styles.sectionHeader}>
            <LocalIonicon
              name="hardware-chip"
              variant="-outline"
              size={24}
              color={primaryColor}
            />
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              System Devices
            </ThemedText>
          </View>

          {devices && devices.length > 0 ? (
            devices.map((device) => (
              <TouchableOpacity
                key={device.deviceId}
                style={[styles.deviceItem, { borderBottomColor: borderColor }]}
                onPress={() =>
                  Alert.alert(
                    `Device: ${device.deviceName}`,
                    `Type: ${device.deviceType}\nSerial: ${device.serialNumber}`
                  )
                }
              >
                <View style={styles.deviceInfo}>
                  <LocalIonicon
                    name={
                      device.deviceType?.includes("Inverter")
                        ? "flash"
                        : device.deviceType?.includes("Sensor")
                        ? "eye"
                        : "apps"
                    }
                    variant="-outline"
                    size={24}
                    color={primaryColor}
                  />
                  <View style={styles.deviceTextContainer}>
                    <ThemedText type="subheading">
                      {device.deviceName}
                    </ThemedText>
                    <ThemedText type="caption">
                      {device.deviceType} - {device.serialNumber}
                    </ThemedText>
                  </View>
                </View>

                <LocalIonicon
                  name="chevron-forward"
                  size={20}
                  color={borderColor}
                />
              </TouchableOpacity>
            ))
          ) : (
            <ThemedText type="caption">No devices found</ThemedText>
          )}
        </ThemedView>

        {/* --- Error Messages Section (Conditional) --- */}
        {latestErrorMessages.length > 0 && (
          <ThemedView
            type="card"
            style={[styles.section, { backgroundColor: cardColor }]}
          >
            <View style={styles.sectionHeader}>
              <LocalIonicon
                name="warning"
                size={24}
                color={statusColors.warning}
              />
              <ThemedText
                type="subtitle"
                style={[styles.sectionTitle, { color: statusColors.warning }]}
              >
                System Errors ({latestErrorMessages.length})
              </ThemedText>
            </View>

            {latestErrorMessages.map((msg, idx) => (
              <View
                key={`error-${idx}`}
                style={[styles.errorItem, { borderBottomColor: borderColor }]}
              >
                <View style={styles.errorHeader}>
                  <LocalIonicon
                    name="alert-circle"
                    size={16}
                    color={statusColors.warning}
                  />
                  <ThemedText type="error" style={styles.errorItemTitle}>
                    {msg.text || "Unknown Error"}
                  </ThemedText>
                </View>
                <ThemedText type="caption" style={styles.errorTimestamp}>
                  {formatDateTime(msg.logDateTime)}
                </ThemedText>
              </View>
            ))}
          </ThemedView>
        )}

        {/* --- System Info Section --- */}
        <ThemedView
          type="card"
          style={[styles.section, { backgroundColor: cardColor }]}
        >
          <View style={styles.sectionHeader}>
            <LocalIonicon
              name="information-circle"
              size={24}
              color={primaryColor}
            />
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              System Information
            </ThemedText>
          </View>

          <View style={[styles.infoRow, { borderBottomColor: borderColor }]}>
            <ThemedText type="subheading">System ID:</ThemedText>
            <ThemedText type="caption" style={styles.infoValue}>
              {pvSystemDetails.pvSystemId}
            </ThemedText>
          </View>

          <View style={[styles.infoRow, { borderBottomColor: borderColor }]}>
            <ThemedText type="subheading">Installation Date:</ThemedText>
            <ThemedText type="body" style={styles.infoValue}>
              {formatDate(pvSystemDetails.installationDate)}
            </ThemedText>
          </View>

          <View style={[styles.infoRow, { borderBottomColor: borderColor }]}>
            <ThemedText type="subheading">Peak Power:</ThemedText>
            <ThemedText type="body" style={styles.infoValue}>
              {pvSystemDetails.peakPower
                ? `${pvSystemDetails.peakPower} W`
                : "N/A"}
            </ThemedText>
          </View>

          <View style={[styles.infoRow, { borderBottomColor: borderColor }]}>
            <ThemedText type="subheading">Time Zone:</ThemedText>
            <ThemedText type="body" style={styles.infoValue}>
              {pvSystemDetails.timeZone || "N/A"}
            </ThemedText>
          </View>
        </ThemedView>
      </ThemedView>
    </ScrollView>
  );
}

// --- Styles ---
const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  container: {
    flex: 1,
    padding: 16,
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
    marginBottom: 20,
  },
  retryButton: {
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    alignItems: "center",
  },
  heroContainer: {
    marginBottom: 16,
    padding: 0,
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  imageOverlay: {
    position: "relative",
  },
  heroImage: {
    width: "100%",
    height: 180,
  },
  placeholderImage: {
    width: "100%",
    height: 180,
    justifyContent: "center",
    alignItems: "center",
  },
  statusBadge: {
    position: "absolute",
    top: 12,
    right: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 16,
  },
  statusText: {
    fontWeight: "bold",
    fontSize: 12,
  },
  heroContent: {
    padding: 16,
  },
  title: {
    marginBottom: 8,
  },
  address: {
    opacity: 0.7,
  },
  statsContainer: {
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  statCard: {
    flex: 1,
    marginHorizontal: 4,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 100,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
    borderRadius: 12,
  },
  statIcon: {
    marginBottom: 8,
  },
  statLabel: {
    marginBottom: 4,
    textAlign: "center",
    opacity: 0.7,
  },
  statValue: {
    textAlign: "center",
    fontWeight: "bold",
  },
  statTimeValue: {
    textAlign: "center",
    fontSize: 12,
  },
  section: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    marginLeft: 8,
  },
  weatherStats: {
    flexDirection: "row",
    justifyContent: "space-between",
    flexWrap: "wrap",
  },
  weatherStat: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    width: "33%",
  },
  weatherValue: {
    marginLeft: 8,
  },
  deviceItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
  },
  deviceInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  deviceTextContainer: {
    marginLeft: 12,
    flex: 1,
  },
  errorItem: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
  },
  errorHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  errorItemTitle: {
    marginLeft: 8,
    flex: 1,
  },
  errorTimestamp: {
    marginTop: 6,
    marginLeft: 24,
    opacity: 0.7,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
  },
  infoValue: {
    textAlign: "right",
    flex: 1,
  },
});

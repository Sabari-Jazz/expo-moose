import React, { useEffect, useState, useRef } from "react";
import {
  StyleSheet,
  View,
  Dimensions,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  Platform,
} from "react-native";
import MapView, { Marker, Callout, PROVIDER_GOOGLE } from "react-native-maps";
import { getPvSystems } from "@/api/api";
import { PvSystem } from "./PvSystemList";
import {
  geocodeAddress,
  formatAddress,
  initGeocoding,
} from "../utils/geocoding";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { ThemedView } from "./ThemedView";
import { ThemedText } from "./ThemedText";
import { useThemeColor } from "@/hooks/useThemeColor";

interface PvSystemWithCoords extends PvSystem {
  coords?: {
    latitude: number;
    longitude: number;
  };
  status?: "online" | "warning" | "offline";
}

interface PvSystemMapProps {
  selectedPvSystemId?: string;
  googleMapsApiKey?: string;
}

// Generate mock coordinates for Canada
const generateMockCoordinates = (index: number) => {
  const baseLatitude = 45.4215;
  const baseLongitude = -75.6972;
  const row = Math.floor(index / 3);
  const col = index % 3;
  return {
    latitude: baseLatitude + row * 0.05,
    longitude: baseLongitude + col * 0.05,
  };
};

// Generate mock status (will be replaced with actual API data)
const generateMockStatus = (): "online" | "warning" | "offline" => {
  const statuses: ("online" | "warning" | "offline")[] = [
    "online",
    "warning",
    "offline",
  ];
  return statuses[Math.floor(Math.random() * statuses.length)];
};

export default function PvSystemMap({
  selectedPvSystemId,
  googleMapsApiKey,
}: PvSystemMapProps) {
  const [pvSystems, setPvSystems] = useState<PvSystemWithCoords[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [region, setRegion] = useState({
    latitude: 45.4215, // Default to Ottawa, Canada
    longitude: -75.6972,
    latitudeDelta: 10,
    longitudeDelta: 10,
  });
  const [selectedSystem, setSelectedSystem] = useState<string | null>(null);
  const mapRef = useRef<MapView>(null);
  const [useRealGeocoding, setUseRealGeocoding] = useState(true);
  const router = useRouter();
  const primaryColor = useThemeColor({}, "tint");

  // Simplified color scheme: green for functioning, red for non-functioning
  const onlineColor = "#4CAF50"; // Green for functioning
  const offlineColor = "#F44336"; // Red for non-functioning
  const warningColor = "#FF9800"; // Orange for warning state

  // Get API key from props or environment variables
  const apiKey =
    googleMapsApiKey ||
    Constants.expoConfig?.extra?.googleMapsApiKey ||
    process.env.GOOGLE_MAPS_API_KEY ||
    "AIzaSyCUayW-NYs3korrX4LGnNmn9O_MXmwBhpE"; // Fallback value

  // Initialize Geocoding with API key
  useEffect(() => {
    if (apiKey) {
      try {
        console.log("Initializing Geocoding with API key");
        initGeocoding(apiKey);
      } catch (err) {
        console.error("Failed to initialize Geocoding:", err);
        setUseRealGeocoding(false);
      }
    } else {
      console.warn("No Google Maps API key provided, using mock coordinates");
      setUseRealGeocoding(false);
    }
  }, [apiKey]);

  // Function to get color based on status
  const getStatusColor = (
    status: "online" | "warning" | "offline" | undefined
  ) => {
    switch (status) {
      case "online":
        return onlineColor;
      case "warning":
        return warningColor;
      case "offline":
        return offlineColor;
      default:
        return onlineColor;
    }
  };

  // Handle marker press - set selected marker
  const handleMarkerPress = (pvSystemId: string) => {
    setSelectedSystem(pvSystemId);
  };

  // Navigate to detail page
  const navigateToDetail = (pvSystemId: string) => {
    router.push({
      pathname: "/pv-detail/[pvSystemId]",
      params: { pvSystemId },
    });
  };

  // Fetch data from API
  const fetchData = async () => {
    try {
      setLoading(true);
      const data = await getPvSystems();

      if (!data || data.length === 0) {
        setError("No PV systems found. Please check your data source.");
        setLoading(false);
        return;
      }

      // Process systems with coordinates and mock status
      const systemsWithCoords = await Promise.all(
        data.map(async (system, index) => {
          try {
            let coords;
            if (
              useRealGeocoding &&
              system.address.street &&
              system.address.city &&
              system.address.zipCode &&
              system.address.country
            ) {
              const formattedAddress = formatAddress({
                street: system.address.street,
                city: system.address.city,
                zipCode: system.address.zipCode,
                country: system.address.country,
                state: system.address.state || null,
              });
              coords = await geocodeAddress(formattedAddress);
            } else {
              coords = generateMockCoordinates(index);
            }

            const status = generateMockStatus();

            return { ...system, coords, status };
          } catch (err) {
            console.error(`Error for ${system.name}:`, err);
            return {
              ...system,
              coords: generateMockCoordinates(index),
              status: "offline",
            };
          }
        })
      );

      setPvSystems(systemsWithCoords as PvSystemWithCoords[]);

      if (selectedPvSystemId) {
        const selectedSystem = systemsWithCoords.find(
          (system) => system.pvSystemId === selectedPvSystemId
        );
        if (selectedSystem?.coords) {
          const targetRegion = {
            latitude: selectedSystem.coords.latitude,
            longitude: selectedSystem.coords.longitude,
            latitudeDelta: 0.1,
            longitudeDelta: 0.1,
          };
          setRegion(targetRegion);
          setTimeout(() => {
            mapRef.current?.animateToRegion(targetRegion, 1000);
          }, 500);
        }
      } else if (systemsWithCoords.length > 0 && systemsWithCoords[0].coords) {
        setRegion({
          latitude: systemsWithCoords[0].coords.latitude,
          longitude: systemsWithCoords[0].coords.longitude,
          latitudeDelta: 10,
          longitudeDelta: 10,
        });
      }

      setError(null);
    } catch (err) {
      console.error("Error fetching PV systems:", err);
      setError("Failed to load PV systems. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedPvSystemId, useRealGeocoding]);

  if (loading) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator size="large" color={primaryColor} />
        <ThemedText type="caption" style={styles.loadingText}>
          Loading Map...
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
      </ThemedView>
    );
  }

  if (!useRealGeocoding && !(apiKey && apiKey !== "YOUR_Maps_API_KEY")) {
    return (
      <ThemedView style={styles.centered}>
        <ThemedText type="error" style={styles.errorText}>
          Missing Google Maps API key. Map cannot be displayed accurately.
          Please check your environment configuration.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={region}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        showsUserLocation={true}
        showsMyLocationButton={true}
        showsCompass={true}
      >
        {pvSystems.map((system) => (
          <Marker
            key={system.pvSystemId}
            coordinate={{
              latitude: system.coords?.latitude || 0,
              longitude: system.coords?.longitude || 0,
            }}
            pinColor={system.status === "online" ? onlineColor : offlineColor}
            onPress={() => handleMarkerPress(system.pvSystemId)}
          >
            <Callout
              tooltip
              onPress={() => navigateToDetail(system.pvSystemId)}
            >
              <ThemedView type="elevated" style={styles.calloutContainer}>
                <View style={styles.callout}>
                  <View style={styles.calloutHeader}>
                    <ThemedText type="heading" style={styles.calloutTitle}>
                      {system.name}
                    </ThemedText>
                    <View
                      style={[
                        styles.statusDot,
                        { backgroundColor: getStatusColor(system.status) },
                      ]}
                    />
                  </View>

                  <View style={styles.calloutImageContainer}>
                    {system.pictureURL ? (
                      <Image
                        source={{ uri: system.pictureURL }}
                        style={styles.calloutImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.placeholderImage}>
                        <ThemedText type="caption">No Image</ThemedText>
                      </View>
                    )}
                  </View>

                  <View style={styles.calloutContent}>
                    <ThemedText type="caption" style={styles.calloutLocation}>
                      {formatAddress({
                        street: system.address.street || "",
                        city: system.address.city || "",
                        zipCode: system.address.zipCode || "",
                        country: system.address.country || "",
                        state: system.address.state || null,
                      })}
                    </ThemedText>

                    <View style={styles.calloutStats}>
                      <View style={styles.stat}>
                        <ThemedText type="caption" style={styles.statLabel}>
                          Status:
                        </ThemedText>
                        <ThemedText
                          type="caption"
                          style={[
                            styles.statValue,
                            { color: getStatusColor(system.status) },
                          ]}
                        >
                          {system.status === "online"
                            ? "Online"
                            : system.status === "warning"
                            ? "Warning"
                            : "Offline"}
                        </ThemedText>
                      </View>

                      <View style={styles.stat}>
                        <ThemedText type="caption" style={styles.statLabel}>
                          Power:
                        </ThemedText>
                        <ThemedText type="caption" style={styles.statValue}>
                          {system.peakPower ? `${system.peakPower} W` : "N/A"}
                        </ThemedText>
                      </View>

                      <View style={styles.stat}>
                        <ThemedText type="caption" style={styles.statLabel}>
                          Installed:
                        </ThemedText>
                        <ThemedText type="caption" style={styles.statValue}>
                          {new Date(
                            system.installationDate
                          ).toLocaleDateString()}
                        </ThemedText>
                      </View>
                    </View>

                    <TouchableOpacity
                      style={styles.viewDetailsButton}
                      onPress={() => navigateToDetail(system.pvSystemId)}
                    >
                      <ThemedText type="link" style={styles.viewDetailsText}>
                        Tap to view details
                      </ThemedText>
                    </TouchableOpacity>
                  </View>
                </View>
              </ThemedView>
            </Callout>
          </Marker>
        ))}
      </MapView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    width: Dimensions.get("window").width,
    height: Dimensions.get("window").height,
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
  calloutContainer: {
    width: 300,
    borderRadius: 8,
    padding: 0,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  callout: {
    width: "100%",
    borderRadius: 8,
    padding: 0,
    overflow: "hidden",
  },
  calloutHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.1)",
  },
  calloutTitle: {
    fontSize: 18,
    flex: 1,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: 8,
  },
  calloutImageContainer: {
    height: 120,
    width: "100%",
  },
  calloutImage: {
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
  calloutContent: {
    padding: 10,
  },
  calloutLocation: {
    marginBottom: 6,
  },
  calloutStats: {
    marginVertical: 8,
  },
  stat: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  statLabel: {
    fontWeight: "bold",
  },
  statValue: {
    marginLeft: 8,
  },
  viewDetailsButton: {
    backgroundColor: "rgba(255,152,0,0.1)",
    padding: 8,
    borderRadius: 4,
    alignItems: "center",
    marginTop: 4,
  },
  viewDetailsText: {
    color: "#FF9800",
  },
});

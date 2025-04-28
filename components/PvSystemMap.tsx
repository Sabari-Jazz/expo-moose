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
  getCoordinatesFromSystem,
} from "../utils/geocoding";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { ThemedView } from "./ThemedView";
import { ThemedText } from "./ThemedText";
import { useThemeColor } from "@/hooks/useThemeColor";
import AsyncStorage from "@react-native-async-storage/async-storage";

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
  const router = useRouter();
  const primaryColor = useThemeColor({}, "tint");

  // Simplified color scheme
  const onlineColor = "#4CAF50"; // Green for functioning
  const offlineColor = "#F44336"; // Red for non-functioning
  const warningColor = "#FF9800"; // Orange for warning state

  // Get API key from props or environment variables
  const apiKey =
    googleMapsApiKey ||
    Constants.expoConfig?.extra?.googleMapsApiKey ||
    process.env.GOOGLE_MAPS_API_KEY;

  // Initialize Geocoding with API key
  useEffect(() => {
    if (apiKey) {
      try {
        console.log("Initializing Geocoding with API key");
        initGeocoding(apiKey);
      } catch (err) {
        console.error("Failed to initialize Geocoding:", err);
      }
    } else {
      console.warn("No Google Maps API key provided, geocoding may not work");
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

      console.log(`Fetched ${data.length} PV systems from API`);

      // Process systems with coordinates and status
      const systemsWithCoords = await Promise.all(
        data.map(async (system) => {
          try {
            let coords;

            // First try to get coordinates directly from the system data
            const existingCoords = getCoordinatesFromSystem(system);
            if (existingCoords) {
              console.log(
                `Using existing coordinates for system ${
                  system.name
                }: ${JSON.stringify(existingCoords)}`
              );
              coords = existingCoords;
            }
            // Then try geocoding if necessary
            else if (
              system.address &&
              system.address.street &&
              system.address.city &&
              (system.address.zipCode || system.address.state) &&
              system.address.country
            ) {
              const formattedAddress = formatAddress({
                street: system.address.street,
                city: system.address.city,
                zipCode: system.address.zipCode || "",
                country: system.address.country,
                state: system.address.state || null,
              });

              try {
                coords = await geocodeAddress(formattedAddress);
                console.log(
                  `Successfully geocoded: ${
                    system.name
                  } at ${formattedAddress} -> ${JSON.stringify(coords)}`
                );
              } catch (geocodeErr) {
                console.error(
                  `Geocoding failed for ${system.name}, no coordinates available`,
                  geocodeErr
                );
                return null;
              }
            } else {
              console.warn(`No location data for system ${system.name}`);
              return null;
            }

            // Determine system status based on API data
            // In a real app, this would come from the API
            let status: "online" | "warning" | "offline" = "online";

            // For now we'll set a default, but this should be replaced with actual status from API
            if (system.status) {
              status = system.status as "online" | "warning" | "offline";
            }

            return { ...system, coords, status };
          } catch (err) {
            console.error(`Error processing system ${system.name}:`, err);
            return null;
          }
        })
      );

      // Filter out systems without coordinates
      const validSystems = systemsWithCoords.filter(
        (system): system is PvSystemWithCoords => system !== null
      );

      console.log(
        `Processed ${validSystems.length} systems with valid coordinates`
      );

      setPvSystems(validSystems);

      // Calculate map region to fit all pins
      if (validSystems.length > 0) {
        if (selectedPvSystemId) {
          const selectedSystem = validSystems.find(
            (system) => system.pvSystemId === selectedPvSystemId
          );
          if (selectedSystem?.coords) {
            const targetRegion = {
              latitude: selectedSystem.coords.latitude,
              longitude: selectedSystem.coords.longitude,
              latitudeDelta: 0.5,
              longitudeDelta: 0.5,
            };
            setRegion(targetRegion);
            setTimeout(() => {
              mapRef.current?.animateToRegion(targetRegion, 1000);
            }, 500);
          }
        } else {
          // Calculate the center and span to include all markers
          let minLat = Number.MAX_VALUE;
          let maxLat = -Number.MAX_VALUE;
          let minLng = Number.MAX_VALUE;
          let maxLng = -Number.MAX_VALUE;

          validSystems.forEach((system) => {
            if (system.coords) {
              minLat = Math.min(minLat, system.coords.latitude);
              maxLat = Math.max(maxLat, system.coords.latitude);
              minLng = Math.min(minLng, system.coords.longitude);
              maxLng = Math.max(maxLng, system.coords.longitude);
            }
          });

          // Add some padding
          const paddingFactor = 0.2;
          const latDelta = (maxLat - minLat) * (1 + paddingFactor);
          const lngDelta = (maxLng - minLng) * (1 + paddingFactor);

          // Ensure minimum deltas for visibility
          const finalLatDelta = Math.max(latDelta, 0.5);
          const finalLngDelta = Math.max(lngDelta, 0.5);

          setRegion({
            latitude: (minLat + maxLat) / 2,
            longitude: (minLng + maxLng) / 2,
            latitudeDelta: finalLatDelta,
            longitudeDelta: finalLngDelta,
          });
        }
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
  }, [selectedPvSystemId]);

  useEffect(() => {
    if (!loading && pvSystems.length > 0 && mapRef.current) {
      // Add a slight delay to ensure map is ready
      setTimeout(() => {
        try {
          // Create an array of valid marker coordinates
          const validCoords = pvSystems
            .filter(
              (system) =>
                system.coords &&
                system.coords.latitude &&
                system.coords.longitude
            )
            .map((system) => ({
              latitude: system.coords!.latitude,
              longitude: system.coords!.longitude,
            }));

          if (validCoords.length > 0 && mapRef.current) {
            console.log(`Fitting map to ${validCoords.length} markers`);

            // If we only have one marker, zoom to it with a reasonable zoom level
            if (validCoords.length === 1) {
              const region = {
                latitude: validCoords[0].latitude,
                longitude: validCoords[0].longitude,
                latitudeDelta: 0.5,
                longitudeDelta: 0.5,
              };
              mapRef.current.animateToRegion(region, 1000);
            } else {
              // Fit to all markers
              mapRef.current.fitToCoordinates(validCoords, {
                edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
                animated: true,
              });
            }
          }
        } catch (err: any) {
          console.error("Error fitting map to coordinates:", err);
        }
      }, 500);
    }
  }, [loading, pvSystems]);

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

  if (!apiKey) {
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
        mapType="standard"
        onMapReady={() => {
          console.log("Map loaded successfully");
        }}
      >
        {pvSystems.map((system) => {
          // Skip systems with invalid coordinates
          if (
            !system.coords ||
            !system.coords.latitude ||
            !system.coords.longitude
          ) {
            return null;
          }

          return (
            <Marker
              key={system.pvSystemId}
              coordinate={{
                latitude: system.coords.latitude,
                longitude: system.coords.longitude,
              }}
              pinColor={getStatusColor(system.status)}
              onPress={() => handleMarkerPress(system.pvSystemId)}
              tracksViewChanges={false}
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
          );
        })}
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

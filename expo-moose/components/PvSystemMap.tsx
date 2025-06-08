import React, { useEffect, useState, useRef } from "react";
import {
  StyleSheet,
  View,
  Dimensions,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  Platform,
  Text,
  Modal,
} from "react-native";
import MapView, { Marker, Callout, PROVIDER_GOOGLE } from "react-native-maps";
import { getSystemProfile, getConsolidatedDailyData } from "@/api/api";
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
import { getCurrentUser } from "@/utils/cognitoAuth";

interface PvSystemWithCoords extends PvSystem {
  coords: {
    latitude: number;
    longitude: number;
  };
  status: "online" | "warning" | "offline";
}



interface PvSystemMapProps {
  selectedPvSystemId?: string;
  googleMapsApiKey?: string;
  hasAccessToSystem?: (systemId: string) => boolean;
  loading?: boolean;
}

export default function PvSystemMap({
  selectedPvSystemId,
  googleMapsApiKey,
  hasAccessToSystem,
  loading: externalLoading,
}: PvSystemMapProps) {
  const [pvSystems, setPvSystems] = useState<PvSystemWithCoords[]>([]);
  const [internalLoading, setInternalLoading] = useState(true);
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
  const [selectedMarker, setSelectedMarker] = useState<PvSystemWithCoords | null>(null);
  const [showAndroidModal, setShowAndroidModal] = useState(false);

  // Platform-specific style helpers
  const getCalloutStyle = () => {
    if (Platform.OS === 'android') {
      return {
        backgroundColor: 'white', // Android needs a visible background
        padding: 0,
        margin: 0,
        width: 320,
        borderRadius: 8,
        overflow: 'hidden' as 'hidden', // Type assertion to fix TypeScript error
        // Add Android-specific shadow
        elevation: 5,
      };
    }
    return {};
  };

  // Debug log for hasAccessToSystem prop
  useEffect(() => {
    console.log(`PVMAP: hasAccessToSystem prop is ${hasAccessToSystem ? 'provided' : 'NOT provided'}`);
    console.log(`PVMAP: External loading state is: ${externalLoading ? 'LOADING' : 'READY'}`);
  }, [hasAccessToSystem, externalLoading]);

  // Determine if the component is loading
  const isLoading = externalLoading || internalLoading;

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
  const handleMarkerPress = (system: PvSystemWithCoords) => {
    if (Platform.OS === 'android') {
      setSelectedMarker(system);
      setShowAndroidModal(true);
    } else {
      setSelectedSystem(system.pvSystemId);
    }
  };

  // Navigate to detail page
  const navigateToDetail = (pvSystemId: string) => {
    router.push({
      pathname: "/pv-detail/[pvSystemId]",
      params: { pvSystemId },
    });
  };

  // Fix for Android callouts - different approach by platform
  const getCalloutHandler = (pvSystemId: string) => {
    if (Platform.OS === 'android') {
      return undefined; // Android doesn't support onPress on Callout
    } else {
      return () => navigateToDetail(pvSystemId); // iOS supports it
    }
  };

  // get boolean status of system from consolidated daily data
  const getStatus = async(systemId: string) => {
    try {
      const today = new Date();
      const formatter = new Intl.DateTimeFormat('en-CA', { 
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit', 
        day: '2-digit'
      });
      const todayDateString = formatter.format(today);
      
      const consolidatedData = await getConsolidatedDailyData(systemId, todayDateString);
      return consolidatedData?.status === "online";
    } catch (error) {
      console.warn(`Failed to get status for system ${systemId}:`, error);
      return false;
    }
  }

  // Fetch data from database using user's accessible systems
  const fetchData = async () => {
    try {
      setInternalLoading(true);
      console.log(`PVMAP: Starting to fetch PV system data from database...`);

      // Get current user and their accessible systems
      const user = await getCurrentUser();
      if (!user) {
        setError("Unable to get current user.");
        setInternalLoading(false);
        return;
      }

      let systemIds: string[] = [];
      if (user.role === "admin") {
        // For admin users, we'd need to get all system IDs
        // For now, we'll use their systems list if available
        systemIds = (user.systems as string[]) || [];
      } else {
        // Regular user: use their assigned systems
        systemIds = (user.systems as string[]) || [];
      }

      if (systemIds.length === 0) {
        console.log(`User ${user.name} has no systems assigned`);
        setPvSystems([]);
        setError(null);
        setInternalLoading(false);
        return;
      }

      console.log(`PVMAP: Fetching profiles for ${systemIds.length} systems assigned to user`);

      // Fetch system profiles from database
      const systemsWithCoords = await Promise.all(
        systemIds.map(async (systemId) => {
          try {
            console.log(`Fetching profile for system: ${systemId}`);
            
            // Get system profile from database
            const profileData = await getSystemProfile(systemId);
            if (!profileData) {
              console.warn(`No profile found for system ${systemId}`);
              return null;
            }

            // Extract address information from profile
            const address = {
              street: profileData.street || null,
              city: profileData.city || null,
              zipCode: profileData.zipCode || null,
              state: profileData.state || null,
              country: profileData.country || null,
            };

            // Try to get coordinates from profile data first
            let coords = getCoordinatesFromSystem(profileData);
            
            // If no coordinates in profile, try geocoding the address
            if (!coords && address.city && address.country) {
              const formattedAddress = formatAddress({
                street: address.street || "",
                city: address.city || "",
                zipCode: address.zipCode || "",
                country: address.country || "",
                state: address.state || null,
              });

              try {
                coords = await geocodeAddress(formattedAddress);
                console.log(`Successfully geocoded: ${profileData.name} at ${formattedAddress} -> ${JSON.stringify(coords)}`);
              } catch (geocodeErr) {
                console.error(`Geocoding failed for ${profileData.name}, no coordinates available`, geocodeErr);
                return null;
              }
            }

            if (!coords) {
              console.warn(`No coordinates available for system ${profileData.name}`);
              return null;
            }

            // Get system status
            const systemStatus = await getStatus(systemId);

            // Create system object compatible with existing interface
            const system = {
              pvSystemId: systemId,
              name: profileData.name || `System ${systemId}`,
              address: address,
              pictureURL: profileData.pictureUrl || null,
              peakPower: profileData.peakPower || null,
              installationDate: profileData.installationDate || new Date().toISOString(),
              lastImport: profileData.lastImport || new Date().toISOString(),
              meteoData: profileData.meteoData || null,
              timeZone: profileData.timeZone || "America/New_York",
              coords: coords,
              status: systemStatus ? "online" : "offline"
            };

            return system;
          } catch (err) {
            console.error(`Error processing system ${systemId}:`, err);
            return null;
          }
        })
      );

      // Filter out systems without coordinates
      const validSystems = systemsWithCoords
        .filter(system => system !== null && system.coords !== undefined)
        .map(system => ({
          ...system!,
          coords: system!.coords!,
          status: (system!.status || "offline") as "online" | "warning" | "offline"
        })) as PvSystemWithCoords[];

      console.log(`Processed ${validSystems.length} systems with valid coordinates from database`);
      
      // Since we're already filtering by user access when getting systemIds,
      // we don't need additional access filtering here
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
      } else {
        // No systems visible, show a zoomed out view
        setRegion({
          latitude: 45.4215, // Default to Ottawa, Canada
          longitude: -75.6972,
          latitudeDelta: 10,
          longitudeDelta: 10,
        });
      }

      setError(null);
    } catch (err) {
      console.error("Error fetching PV systems from database:", err);
      setError("Failed to load PV systems from database. Please try again later.");
    } finally {
      setInternalLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedPvSystemId]);

  useEffect(() => {
    if (!isLoading && pvSystems.length > 0 && mapRef.current) {
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
  }, [isLoading, pvSystems]);

  if (isLoading) {
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
          console.log(`PVMAP: Map loaded successfully with ${pvSystems.length} markers`);
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
              onPress={() => {
                if (Platform.OS === 'android') {
                  // For Android, use custom modal solution
                  handleMarkerPress(system);
                } else {
                  // For iOS, use standard callout
                  handleMarkerPress(system);
                }
              }}
              tracksViewChanges={false}
            >
              {Platform.OS !== 'android' && (
                <Callout
                  tooltip
                  onPress={getCalloutHandler(system.pvSystemId)}
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
              )}
            </Marker>
          );
        })}
      </MapView>

      {/* Android custom modal for marker details */}
      {Platform.OS === 'android' && (
        <Modal
          visible={showAndroidModal}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowAndroidModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              {selectedMarker && (
                <>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>{selectedMarker.name}</Text>
                    <View
                      style={[
                        styles.statusDot,
                        { backgroundColor: getStatusColor(selectedMarker.status) },
                      ]}
                    />
                    <TouchableOpacity 
                      style={styles.closeButton}
                      onPress={() => setShowAndroidModal(false)}
                    >
                      <Text style={styles.closeButtonText}>×</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.modalImageContainer}>
                    {selectedMarker.pictureURL ? (
                      <Image
                        source={{ uri: selectedMarker.pictureURL }}
                        style={styles.modalImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.modalPlaceholderImage}>
                        <Text style={styles.modalText}>No Image</Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.modalContent}>
                    <Text style={styles.modalAddressText}>
                      {formatAddress({
                        street: selectedMarker.address.street || "",
                        city: selectedMarker.address.city || "",
                        zipCode: selectedMarker.address.zipCode || "",
                        country: selectedMarker.address.country || "",
                        state: selectedMarker.address.state || null,
                      })}
                    </Text>

                    <View style={styles.modalStats}>
                      <View style={styles.modalStat}>
                        <Text style={styles.modalStatLabel}>Status:</Text>
                        <Text 
                          style={[
                            styles.modalStatValue, 
                            {color: getStatusColor(selectedMarker.status)}
                          ]}
                        >
                          {selectedMarker.status === "online" 
                            ? "Online" 
                            : selectedMarker.status === "warning" 
                              ? "Warning" 
                              : "Offline"}
                        </Text>
                      </View>

                      <View style={styles.modalStat}>
                        <Text style={styles.modalStatLabel}>Power:</Text>
                        <Text style={styles.modalStatValue}>
                          {selectedMarker.peakPower 
                            ? `${selectedMarker.peakPower} W` 
                            : "N/A"}
                        </Text>
                      </View>

                      <View style={styles.modalStat}>
                        <Text style={styles.modalStatLabel}>Installed:</Text>
                        <Text style={styles.modalStatValue}>
                          {new Date(selectedMarker.installationDate).toLocaleDateString()}
                        </Text>
                      </View>
                    </View>

                    <TouchableOpacity
                      style={styles.modalDetailsButton}
                      onPress={() => {
                        setShowAndroidModal(false);
                        navigateToDetail(selectedMarker.pvSystemId);
                      }}
                    >
                      <Text style={styles.modalDetailsButtonText}>
                        View Details
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>
      )}
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
    zIndex: 999,
    ...Platform.select({
      android: {
        width: 320, // Slightly wider on Android
      }
    })
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
  androidCalloutContainer: {
    width: 320, // Slightly wider on Android
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 0,
    // Android needs explicit sizing and styling
    minHeight: 350, // Ensure enough height to show content
    elevation: 5,
  },
  androidCallout: {
    width: '100%',
    backgroundColor: 'white',
    flexDirection: 'column',
    alignItems: 'stretch',
    borderRadius: 8,
    overflow: 'hidden',
  },
  androidCalloutHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.1)",
    backgroundColor: 'white',
  },
  androidTitle: {
    fontSize: 18,
    flex: 1,
    color: '#000000',
    fontWeight: 'bold',
  },
  androidText: {
    color: '#000000', // Ensure text is black for visibility
    opacity: 1,       // Make sure opacity is full
    fontSize: 14,     // Slightly larger font size
    fontWeight: '400', // Medium font weight
    marginVertical: 2,
  },
  androidImageContainer: {
    height: 120,
    width: "100%",
  },
  androidCalloutImage: {
    width: "100%",
    height: "100%",
  },
  androidPlaceholderImage: {
    width: "100%",
    height: "100%",
    backgroundColor: "#e0e0e0",
    justifyContent: "center",
    alignItems: "center",
  },
  androidCalloutContent: {
    padding: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '90%',
    maxWidth: 350,
    backgroundColor: 'white',
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 5,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    flex: 1,
    color: '#000',
  },
  closeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  closeButtonText: {
    fontSize: 22,
    color: '#000',
    lineHeight: 22,
  },
  modalImageContainer: {
    height: 180,
    width: '100%',
  },
  modalImage: {
    width: '100%',
    height: '100%',
  },
  modalPlaceholderImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#e0e0e0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalText: {
    color: '#000',
    fontSize: 14,
  },
  modalAddressText: {
    color: '#000',
    fontSize: 14,
    marginBottom: 10,
    paddingHorizontal: 15,
    paddingTop: 15,
  },
  modalStats: {
    marginVertical: 10,
    paddingHorizontal: 15,
  },
  modalStat: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  modalStatLabel: {
    fontWeight: 'bold',
    width: 80,
    color: '#000',
    fontSize: 14,
  },
  modalStatValue: {
    flex: 1,
    color: '#000',
    fontSize: 14,
  },
  modalDetailsButton: {
    margin: 15,
    marginTop: 5,
    backgroundColor: '#0077cc',
    padding: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  modalDetailsButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

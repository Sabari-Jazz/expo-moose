import { useState, useEffect } from "react";
import Animated, { FadeInUp, FadeInDown } from "react-native-reanimated";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { View, Text } from 'react-native';
import * as api from "@/api/api";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet } from 'react-native';
import { useTheme } from "@/hooks/useTheme";

export default function WeatherWidget({ pvSystemId }: { pvSystemId: string | undefined }) {
    useEffect(() => {
        if (!pvSystemId) {
            console.warn("No pvSystemId provided, skipping weather fetch.");
            return;
        }
        const fetchWeather = async () => {
            const [weatherResult] = await Promise.allSettled([
              api.getCurrentWeather(pvSystemId),
            ]);
        
            if (weatherResult.status === "fulfilled") {
              setWeatherData(weatherResult.value);
            } else {
              console.error("Failed Weather:", weatherResult.reason);
              setWeatherData(null); // optional fallback
            }
          };
        
          fetchWeather();
    }, [])



    
    const [weatherData, setWeatherData] = useState<api.CurrentWeatherResponse | null>(null);;
    const { isDarkMode, colors } = useTheme();

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

    // Helper function to get weather icon name based on symbol code
    const getWeatherIcon = (
        symbol: string | null
    ): keyof typeof Ionicons.glyphMap => {
        if (!symbol) return "cloudy-outline";

        const iconMap: Record<string, keyof typeof Ionicons.glyphMap> = {
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

    if (!weatherData || !weatherData.data) {
        return (
            <Animated.View
                entering={FadeInUp.delay(200).springify()}
                style={[
                    styles.section,
                    { backgroundColor: isDarkMode ? colors.card : "#fff" },
                ]}
            >
                <ThemedText style={styles.sectionTitle}>
                    Weather Conditions
                </ThemedText>
                <View style={styles.weatherNoDataContent}>
                    <Ionicons
                        name="cloudy-outline"
                        size={48}
                        color={isDarkMode ? "#888" : "#aaaaaa"}
                    />
                    <ThemedText style={[styles.infoValue, { marginTop: 12 }]}>
                        Weather data unavailable
                    </ThemedText>
                </View>
            </Animated.View>
        );
    }

    const temperature = findChannelValue(weatherData.data.channels, "Temp");
    const humidity = findChannelValue(
        weatherData.data.channels,
        "RelativeHumidity"
    );
    const windSpeed = findChannelValue(weatherData.data.channels, "WindSpeed");
    const cloudCover = findChannelValue(
        weatherData.data.channels,
        "CloudCover"
    );
    const irradiance = findChannelValue(
        weatherData.data.channels,
        "Irradiation"
    );
    const weatherSymbol = findChannelValue(weatherData.data.channels, "Symbol");

    // Get weather description and icon
    const weatherDesc = getWeatherDescription(weatherSymbol);
    const weatherIcon = getWeatherIcon(weatherSymbol);

    // Define weather assessment for solar production
    const getWeatherAssessment = () => {
        if (cloudCover !== null) {
            if (cloudCover < 30) return { text: "Excellent", color: "#4CAF50" };
            if (cloudCover < 60) return { text: "Good", color: "#8BC34A" };
            if (cloudCover < 80) return { text: "Fair", color: "#FFC107" };
            return { text: "Poor", color: "#FF9800" };
        }

        // Fallback if no cloud cover data
        if (weatherSymbol) {
            const symbol = Number(weatherSymbol);
            if (symbol <= 1) return { text: "Excellent", color: "#4CAF50" };
            if (symbol <= 3) return { text: "Good", color: "#8BC34A" };
            if (symbol <= 5) return { text: "Fair", color: "#FFC107" };
            return { text: "Poor", color: "#FF9800" };
        }

        return { text: "Unknown", color: "#9E9E9E" };
    };

    const assessment = getWeatherAssessment();

    return (
        <Animated.View
            entering={FadeInUp.delay(200).springify()}
            style={[
                styles.section,
                { backgroundColor: isDarkMode ? colors.card : "#fff" },
            ]}
        >
            <ThemedText style={styles.sectionTitle}>Weather Conditions</ThemedText>

            <View style={styles.weatherHeader}>
                <View style={styles.weatherMainInfo}>
                    <View style={styles.weatherIconContainer}>
                        <Ionicons name={weatherIcon} size={48} color={colors.primary} />
                    </View>
                    <View>
                        <Text style={[styles.weatherTemperature, { color: colors.text }]}>
                            {temperature !== null ? `${temperature.toFixed(1)}°C` : "--°C"}
                        </Text>
                        <Text style={[styles.weatherCondition, { color: colors.text }]}>
                            {weatherDesc}
                        </Text>
                    </View>
                </View>

                <View
                    style={[
                        styles.assessmentBadge,
                        { backgroundColor: `${assessment.color}20` },
                    ]}
                >
                    {/* <Text style={[styles.assessmentText, { color: assessment.color }]}>
                        {assessment.text} for solar
                    </Text> */}
                </View>
            </View>

            <View style={styles.weatherGridContainer}>
                <View style={styles.weatherGridItem}>
                    <Ionicons name="water-outline" size={22} color={colors.primary} />
                    <ThemedText style={styles.weatherGridLabel}>Humidity:</ThemedText>
                    <ThemedText
                        style={styles.weatherGridValue}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                    >
                        {humidity !== null ? `${humidity.toFixed(0)}%` : "--"}
                    </ThemedText>
                </View>

                <View style={styles.weatherGridItem}>
                    <Ionicons
                        name="speedometer-outline"
                        size={22}
                        color={colors.primary}
                    />
                    <ThemedText style={styles.weatherGridLabel}>Wind:</ThemedText>
                    <ThemedText
                        style={styles.weatherGridValue}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                    >
                        {windSpeed !== null ? `${windSpeed.toFixed(1)} km/h` : "--"}
                    </ThemedText>
                </View>

                <View style={styles.weatherGridItem}>
                    <Ionicons name="cloudy-outline" size={22} color={colors.primary} />
                    <ThemedText style={styles.weatherGridLabel}>
                        Cloud Cover:
                    </ThemedText>
                    <ThemedText
                        style={styles.weatherGridValue}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                    >
                        {cloudCover !== null ? `${cloudCover.toFixed(0)}%` : "--"}
                    </ThemedText>
                </View>

                <View style={styles.weatherGridItem}>
                    <Ionicons name="sunny-outline" size={22} color={colors.primary} />
                    <ThemedText style={styles.weatherGridLabel}>Irradiance:</ThemedText>
                    <ThemedText
                        style={styles.weatherGridValue}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                    >
                        {irradiance !== null ? `${irradiance.toFixed(0)} W/m²` : "--"}
                    </ThemedText>
                </View>
            </View>

            <Text
                style={[styles.weatherUpdated, { color: colors.text, opacity: 0.5 }]}
            >
                Last updated: {formatDateTime(weatherData.data.logDateTime)}
            </Text>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
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
        padding: 30,
        borderRadius: 12, // Shadow
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
    weatherNoDataContent: {
        alignItems: "center",
        justifyContent: "center",
        padding: 30,
    },
    infoValue: {
        flex: 1,
        opacity: 0.7,
    },
    weatherHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 16,
    },
      weatherMainInfo: {
        flexDirection: "row",
        alignItems: "center",
    },
      assessmentBadge: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
        marginLeft: 8,
    },
      assessmentText: {
        fontSize: 13,
        fontWeight: "bold",
    },
      weatherGridContainer: {
        flexDirection: "row",
        flexWrap: "wrap",
        marginBottom: 16,
    },
      weatherGridItem: {
        width: "50%",
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 8,
        paddingHorizontal: 2,
    },
      weatherGridLabel: {
        fontSize: 14,
        fontWeight: "500",
        marginLeft: 8,
        width: 90,
        flexShrink: 0,
    },
      weatherGridValue: {
        fontSize: 14,
        flexShrink: 1,
        overflow: "hidden",
    },
    weatherIconContainer: {
        marginRight: 12,
    },
      weatherDataContainer: {
        flex: 1,
    },
      weatherTemperature: {
        fontSize: 26,
        fontWeight: "bold",
    },
      weatherCondition: {
        fontSize: 16,
        opacity: 0.8,
    },
    weatherUpdated: {
        fontSize: 12,
        textAlign: "right",
    },



})
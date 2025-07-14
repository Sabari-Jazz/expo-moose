// File: app/pv-detail/[pvSystemId].tsx

import React, { useEffect, useState, useRef } from "react";
import {
  StyleSheet,
  View,
  Text,
  Image,
  ActivityIndicator,
  ScrollView,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
  Dimensions,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import * as api from "@/api/api";
import { ThemedText } from "@/components/ThemedText";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import Animated, { FadeInUp, FadeInDown } from "react-native-reanimated";
import { Card, Divider, Chip, Button } from "react-native-paper";
import { getCurrentUser, hasSystemAccess } from "@/utils/cognitoAuth";
import { LineChart, BarChart } from "react-native-chart-kit";
import WeatherWidget from '../../components/WeatherWidget';
import StatusIcon from "@/components/StatusIcon";
import PowerFlowDiagram from '../../components/PowerFlowDiagram';

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

// Add a helper function to format API date strings properly
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

// Update the getIsoDateString function to format dates correctly for API
const getIsoDateString = (date: Date): string => {
  return formatApiDateString(date);
};

// Add a helper function for getting the first day of the week (Monday)
const getFirstDayOfWeek = (d: Date): Date => {
  const day = d.getDay();
  // Adjust when day is 0 (Sunday)
  const diff = d.getDate() - (day === 0 ? 6 : day - 1);
  const firstDay = new Date(d.setDate(diff));
  // Reset time to start of day
  firstDay.setHours(0, 0, 0, 0);
  return firstDay;
};

// Add a helper function for getting the first day of a month
const getFirstDayOfMonth = (d: Date): Date => {
  const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
  firstDay.setHours(0, 0, 0, 0);
  return firstDay;
};

// Add a helper function for getting the first day of a year
const getFirstDayOfYear = (d: Date): Date => {
  const firstDay = new Date(d.getFullYear(), 0, 1); // Jan 1st
  firstDay.setHours(0, 0, 0, 0);
  return firstDay;
};

export default function PvSystemDetailScreen() {
  const { pvSystemId } = useLocalSearchParams<{ pvSystemId?: string }>();
  const router = useRouter();
  const { isDarkMode, colors } = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  // State for all fetched data
  const [pvSystemDetails, setPvSystemDetails] =
    useState<api.PvSystemMetadata | null>(null);
  const [devices, setDevices] = useState<api.DeviceMetadata[]>([]);

  // Combined loading and error states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  

  // State for historical chart data
  const [energyHistData, setEnergyHistData] =
    useState<api.HistoricalDataResponse | null>(null);
  const [yearlyMonthlyData, setYearlyMonthlyData] = useState<Array<{ month: string, total: number }> | null>(null);
  const [selectedChartPeriod, setSelectedChartPeriod] = useState<
    "day" | "week" | "month" | "year"
  >("day");
  const [chartLoading, setChartLoading] = useState(false);

  // Add state for selected time period in dashboard
  const [selectedDashboardPeriod, setSelectedDashboardPeriod] = useState<
    "today" | "week" | "month" | "year"
  >("today");

  // Add states for different period metrics
 


  // Dashboard flatlist ref for programmatic scrolling
  const dashboardFlatListRef = useRef<FlatList>(null);

  const [dashboardSectionWidth, setDashboardSectionWidth] = useState<number>(Dimensions.get('window').width);

  // Add states for current power and daily energy from consolidated data
  const [consolidatedDailyData, setConsolidatedDailyData] = useState<any>(null);
  const [consolidatedWeeklyData, setConsolidatedWeeklyData] = useState<any>(null);
  const [consolidatedMonthlyData, setConsolidatedMonthlyData] = useState<any>(null);
  const [consolidatedYearlyData, setConsolidatedYearlyData] = useState<any>(null);
  const [expectedEarnings, setExpectedEarnings] = useState<api.ExpectedEarningsResponse | null>(null);

  // ... existing code for other computed values ...

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

        const access = await hasSystemAccess(user.id, pvSystemId as string);
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
  const createCompleteTimeSeriesForDay = (apiData: any[], startDate: Date): any[] => {
    // Create a map of existing data points by their timestamps
    const dataMap = new Map();
    apiData.forEach(item => {
      const timestamp = new Date(item.logDateTime).getTime();
      dataMap.set(timestamp, item);
    });
    
    // Generate all 30-minute intervals from 00:00 to 24:00 (48 intervals)
    const completeData = [];
    const currentTime = new Date(startDate);
    
    for (let i = 0; i < 48; i++) {
      const intervalTime = new Date(currentTime);
      intervalTime.setMinutes(i * 30);
      
      const timestamp = intervalTime.getTime();
      const existingData = dataMap.get(timestamp);
      
      if (existingData) {
        // Use existing data
        completeData.push(existingData);
      } else {
        // Create placeholder with 0 values
        completeData.push({
          logDateTime: intervalTime.toISOString(),
          logDuration: 1800,
          channels: [
            {
              name: "EnergyProductionTotal",
              value: 0,
              unit: "Wh"
            }
          ]
        });
      }
    }
    
    return completeData;
  };

  const createCompleteWeeklyData = (apiData: any[], startDate: Date): any[] => {
    // Create a map of existing data points by their date strings
    const dataMap = new Map();
    apiData.forEach(item => {
      const itemDate = new Date(item.logDateTime);
      const dateKey = itemDate.toISOString().split('T')[0]; // YYYY-MM-DD format
      dataMap.set(dateKey, item);
    });
    
    // Generate all 7 days of the week (Monday to Sunday)
    const completeData = [];
    const currentDate = new Date(startDate);
    
    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(currentDate);
      dayDate.setDate(currentDate.getDate() + i);
      
      const dateKey = dayDate.toISOString().split('T')[0]; // YYYY-MM-DD format
      const existingData = dataMap.get(dateKey);
      
      if (existingData) {
        // Use existing data
        completeData.push(existingData);
      } else {
        // Create placeholder with 0 values for missing days
        completeData.push({
          logDateTime: dayDate.toISOString().split('T')[0] + 'T00:00:00Z',
          logDuration: 86400, // Duration for a day in seconds
          channels: [
            {
              name: "EnergyProductionTotal",
              value: 0,
              unit: "Wh"
            }
          ]
        });
      }
    }
    
    return completeData;
  };

  const getShortDateString = (date: Date): string => {
    return date.toISOString().split("T")[0]; // YYYY-MM-DD
  };

  // NEW: Simplified data extraction for consolidated data
  
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

  const extractEnergyFromConsolidatedData = (consolidatedData: any): string => {
    console.log("PRINTING CONSOLIDATED DATA INSIDE ENERGY:", consolidatedData);
    if (!consolidatedData || consolidatedData.energyProductionWh === undefined) {
      return "0.0 Wh";
    }
    console.log("PRINTING REAL CONSOLIDATED ENERGY:", consolidatedData.energyProductionWh);
    const energyWh = consolidatedData.energyProductionWh; // Already in Wh
    return formatEnergyValue(energyWh);
  };

  const extractPowerFromConsolidatedData = (consolidatedData: any): string => {
    console.log("PRINTING CONSOLIDATED DATA INSIDE POWER:", consolidatedData);
    if (!consolidatedData || consolidatedData.currentPowerW === undefined) {
      return "0.0 W";
    }
    console.log("PRINTING REAL CONSOLIDATED POWER:", consolidatedData.currentPowerW);
    const powerW = consolidatedData.currentPowerW; // Already in W
    return formatPowerValue(powerW);
  };

  const extractCO2FromConsolidatedData = (consolidatedData: any): number => {
    console.log("PRINTING CONSOLIDATED DATA INSIDE CO2:", consolidatedData);
    if (!consolidatedData || consolidatedData.co2Savings === undefined) {
      return 0.0;
    }
    console.log("PRINTING REAL CONSOLIDATED CO2:", consolidatedData.co2Savings);
    return consolidatedData.co2Savings; // Already in kg
  };

  const extractEarningsFromConsolidatedData = (consolidatedData: any): number => {
    console.log("PRINTING CONSOLIDATED DATA INSIDE EARNINGS:", consolidatedData);
    if (!consolidatedData || consolidatedData.earnings === undefined) {
      return 0.0;
    }
    console.log("PRINTING REAL CONSOLIDATED EARNINGS:", consolidatedData.earnings);
    return consolidatedData.earnings; // Already in dollars
  };

  // Updated fetchAllData function with consolidated approach
  const fetchAllData = async () => {
    if (!pvSystemId || hasAccess === false) return;

    setLoading(true);
    setError(null);

    try {
      // Get actual current date for daily data
      const actualToday = new Date();
      
      // Use Intl.DateTimeFormat to get EST date properly
      const formatter = new Intl.DateTimeFormat('en-CA', { 
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit', 
        day: '2-digit'
      });
      const todayDateString = formatter.format(actualToday); // Returns "2025-06-05" format

      /*
      const todayDateString = actualToday.toISOString().split("T")[0]; // YYYY-MM-DD format
      console.log("PRINTING UTC DATE:", todayDateString);
      */
      // Calculate other periods from the actual current date
      const weekFromDate = getFirstDayOfWeek(actualToday);
      const monthFromDate = getFirstDayOfMonth(actualToday);
      const yearFromDate = getFirstDayOfYear(actualToday);


      // For API calls that require date ranges
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 1);

      console.log("Starting consolidated data fetch for all periods");

      const [
        details,
        consolidatedDaily,
        consolidatedWeekly,
        consolidatedMonthly,
        consolidatedYearly,
        devs,
        expectedEarningsData,
      ] = await Promise.allSettled([
        api.getPvSystemDetails(pvSystemId),
        api.getConsolidatedDailyData(pvSystemId, todayDateString), // Use EST date instead of hardcoded
        api.getConsolidatedWeeklyData(pvSystemId, getShortDateString(weekFromDate)),
        api.getConsolidatedMonthlyData(pvSystemId, getShortDateString(monthFromDate).substring(0, 7)), // YYYY-MM format
        api.getConsolidatedYearlyData(pvSystemId, getShortDateString(yearFromDate).substring(0, 4)), // YYYY format
        api.getPvSystemDevices(pvSystemId),
        api.getSystemExpectedEarnings(pvSystemId),
      ]);

      // Set State based on results
      if (details.status === "fulfilled") {
        setPvSystemDetails(details.value);
      } 
      else {
        console.error("Failed Details:", details.reason);
        throw details.reason;
      } // Throw if essential details fail

      // Process consolidated daily data
      if (consolidatedDaily.status === "fulfilled") {
        const dailyData = consolidatedDaily.value;
        console.log("jConsolidated Daily Data:", dailyData);
        setConsolidatedDailyData(dailyData);
    
      } else {
        console.error("=== FAILED CONSOLIDATED DAILY ===");
        console.error("Daily error:", consolidatedDaily.reason);
        // Set defaults
        setConsolidatedDailyData(null);
      }

      // Process consolidated weekly data
      if (consolidatedWeekly.status === "fulfilled") {
        const weeklyData = consolidatedWeekly.value;
        console.log("jConsolidated Weekly Data:", weeklyData);
        setConsolidatedWeeklyData(weeklyData);
   
      } else {
        console.error("=== FAILED CONSOLIDATED WEEKLY ===");
        console.error("Weekly error:", consolidatedWeekly.reason);
        setConsolidatedWeeklyData(null);
      }

      // Process consolidated monthly data
      if (consolidatedMonthly.status === "fulfilled") {
        const monthlyData = consolidatedMonthly.value;
        console.log("jConsolidated Monthly Data:", monthlyData);
        setConsolidatedMonthlyData(monthlyData);
      } else {
        console.error("=== FAILED CONSOLIDATED MONTHLY ===");
        console.error("Monthly error:", consolidatedMonthly.reason);
        setConsolidatedMonthlyData(null);
      }

      // Process consolidated yearly data
      if (consolidatedYearly.status === "fulfilled") {
        const yearlyData = consolidatedYearly.value;
        console.log("jConsolidated Yearly Data:", yearlyData);
        setConsolidatedYearlyData(yearlyData);
        
       
      } else {
        console.error("=== FAILED CONSOLIDATED YEARLY ===");
        console.error("Yearly error:", consolidatedYearly.reason);
        setConsolidatedYearlyData(null);
      }

      if (devs.status === "fulfilled")
        setDevices(devs.value ?? []); // Default to empty array if null
      else console.error("Failed Devices:", devs.reason);
      // Process expected earnings data
      if (expectedEarningsData.status === "fulfilled") {
        const earningsData = expectedEarningsData.value;
        console.log("Expected Earnings Data:", earningsData);
        setExpectedEarnings(earningsData);
      } else {
        console.error("Failed Expected Earnings:", expectedEarningsData.reason);
        setExpectedEarnings(null);
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
      setRefreshing(false);
    }
  };

  // Function to fetch historical data for charts
  const fetchHistoricalData = async (
    period: "day" | "week" | "month" | "year"
  ) => {
    if (!pvSystemId || hasAccess === false) return;

    setChartLoading(true);
    setEnergyHistData(null); // Clear previous data
    setYearlyMonthlyData(null); // Clear previous yearly data

    try {
      const now = new Date();
      let fromDate = new Date();
      let toDate = new Date(now); // Use current time as 'to' for day view
      let durationDays: number;

      console.log(`Fetching energy data for ${period} view`);

      if (period === "year") {
        // Clear yearly data when switching to other periods
        setYearlyMonthlyData(null);
        
        // For yearly view, get 12 months of aggregated data starting from 12 months ago
        const currentDate = new Date();
        const startDate = new Date(currentDate);
        startDate.setMonth(startDate.getMonth() - 11); // Go back 11 months to get 12 months total
        
        const fromStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM format
        const durationMonths = 12;

        console.log(`Fetching yearly aggregated data from ${fromStr} for ${durationMonths} months`);

        try {
          const energyData = await api.getPvSystemAggregatedData(
            pvSystemId as string,
            {
              from: fromStr,
              duration: durationMonths,
              channel: "EnergyProductionTotal",
            }
          );

          if (energyData && energyData.data && energyData.data.length > 0) {
                         // Process the monthly data for yearly view
             const processedData: Array<{ month: string, total: number }> = energyData.data.map((item) => {
               const date = new Date(item.logDateTime);
               const month = String(date.getMonth() + 1).padStart(2, '0'); // 01, 02, etc.
               const year = String(date.getFullYear()).slice(-2); // 24 from 2024
               const energyValue = findChannelValue(item.channels, "EnergyProductionTotal");
               const total = energyValue !== null ? Math.max(0, energyValue / 1000) : 0; // Convert Wh to kWh

               return {
                 month: `${month}/${year}`,
                 total: total
               };
             });

            console.log(`Retrieved ${processedData.length} monthly data points for yearly chart`);
            setYearlyMonthlyData(processedData);
            setEnergyHistData(null); // Clear historical data for yearly view
          } else {
            console.log(`No yearly data returned`);
            setYearlyMonthlyData(null);
            setEnergyHistData(null);
          }
        } catch (err) {
          console.error(`Failed to fetch yearly aggregated data:`, err);
          setYearlyMonthlyData(null);
          setEnergyHistData(null);
        }
      } else if (period === "day") {
        // Clear yearly data when switching to other periods
        setYearlyMonthlyData(null);
        
        // For day view, get data from 00:00 of current day to 24:00 (end of day)
        fromDate.setHours(0, 0, 0, 0); // Set to start of current day (00:00)
        toDate.setHours(24, 0, 0, 0); // Set to end of current day (24:00 = 00:00 next day)

        // Format dates correctly for the histdata API (ISO 8601)
        const fromStr = getIsoDateString(fromDate);
        const toStr = getIsoDateString(toDate);

        console.log(`🕐 DAILY CHART - Fetching data from 00:00 to 24:00 of current day: ${fromStr} to ${toStr}`);

        try {
          // Call getPvSystemHistoricalData instead of getPvSystemAggregatedData
          const energyData = await api.getPvSystemHistoricalData(
            pvSystemId as string,
            {
            from: fromStr,
            to: toStr,
              channel: "EnergyProductionTotal",
              // Optional: Add timezone parameter if needed
              timezone: "local",
            }
          );

          console.log('🕐 DAILY CHART - Raw API response:', energyData);

          // For day view, create complete time series from 00:00 to 24:00 and fill missing slots
          if (period === "day") {
            console.log(`🕐 DAILY CHART - Original API data points: ${energyData?.data?.length || 0}`);
            const completeTimeData = createCompleteTimeSeriesForDay(energyData?.data || [], fromDate);
            const completeEnergyData = {
              ...energyData,
              data: completeTimeData
            };
            setEnergyHistData(completeEnergyData);
            console.log(`🕐 DAILY CHART - Created complete time series with ${completeTimeData.length} data points (should be 48)`);
          } else {
            if (energyData && energyData.data && energyData.data.length > 0) {
              // Set the state directly with the HistoricalDataResponse
              setEnergyHistData(energyData);
              console.log(`🕐 DAILY CHART - Retrieved ${energyData.data.length} data points for ${period} energy chart`);
              console.log('🕐 DAILY CHART - First 5 data points:', energyData.data.slice(0, 5));
              console.log('🕐 DAILY CHART - Last 5 data points:', energyData.data.slice(-5));
              
              // Log timestamp range
              const firstTimestamp = energyData.data[0]?.logDateTime;
              const lastTimestamp = energyData.data[energyData.data.length - 1]?.logDateTime;
              console.log('🕐 DAILY CHART - Time range:', { firstTimestamp, lastTimestamp });
              
            } else {
              console.log(`🕐 DAILY CHART - No historical data returned for ${period} view`);
              setEnergyHistData(null);
            }
          }
        } catch (err) {
          console.error(
            `Failed to fetch historical energy data for ${period}:`,
            err
          );
          setEnergyHistData(null);
        }
      } else {
        // Clear yearly data when switching to other periods
        setYearlyMonthlyData(null);
        
        // Calendar-based period calculations
        if (period === "week") {
          // Find Monday of current week
          fromDate = getFirstDayOfWeek(new Date());
          durationDays = 7; // Always fetch full week (Monday to Sunday)
        } else if (period === "month") {
          // For monthly view, we want 5 weeks of data (35 days)
          // Find the Monday of 4 weeks ago (so we get 5 weeks total including current partial week)
          const currentMonday = getFirstDayOfWeek(new Date());
          fromDate = new Date(currentMonday);
          fromDate.setDate(fromDate.getDate() - 28); // Go back 4 weeks (28 days)
          durationDays = 35; // 5 weeks worth of data
        } else {
          // For yearly view, we'll use consolidated monthly data API calls instead
          // This will be handled separately in the chart processing
          fromDate = new Date(); // Not used for yearly view
          durationDays = 1; // Not used for yearly view
        }

        // Format date string for API
        const fromStr = getShortDateString(fromDate);

        console.log(
          `Fetching aggregated energy data for ${period} view from ${fromStr} for ${durationDays} days`
        );

        try {
          // For all periods, we fetch aggregated daily data
          const energyData = await api.getPvSystemAggregatedData(
            pvSystemId as string,
            {
              from: fromStr,
              duration: durationDays,
              channel: "EnergyProductionTotal",
            }
          );

          if (energyData && energyData.data && energyData.data.length > 0) {
            // Adapt aggregated data format to match historical data format if needed
            const adaptedEnergyData: api.HistoricalDataResponse = {
              pvSystemId: energyData.pvSystemId,
              deviceId: energyData.deviceId || null,
              data: energyData.data.map((item) => ({
                logDateTime: item.logDateTime.includes("T")
                  ? item.logDateTime
                  : `${item.logDateTime}T00:00:00Z`, // Ensure proper datetime format
                logDuration: 86400, // Duration for a day in seconds
                channels: item.channels.map((ch) => ({ ...ch })),
              })),
            };

            console.log(
              `Retrieved ${adaptedEnergyData.data.length} data points for ${period} energy chart`
            );

            // For weekly view, create complete week data with all 7 days
            if (period === "week") {
              console.log(`📅 WEEKLY CHART - Original API data points: ${adaptedEnergyData.data.length}`);
              const completeWeekData = createCompleteWeeklyData(adaptedEnergyData.data, fromDate);
              const completeWeeklyEnergyData = {
                ...adaptedEnergyData,
                data: completeWeekData
              };
              setEnergyHistData(completeWeeklyEnergyData);
              console.log(`📅 WEEKLY CHART - Created complete week with ${completeWeekData.length} days (should be 7)`);
            } else {
              setEnergyHistData(adaptedEnergyData);
            }
          } else {
            console.log(`No data returned for ${period} view`);
            setEnergyHistData(null);
          }
        } catch (err) {
          console.error(`Failed to fetch energy data for ${period}:`, err);
          setEnergyHistData(null);
        }
      }
    } catch (err) {
      console.error(`Error fetching chart data for period ${period}:`, err);
    } finally {
      setChartLoading(false);
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

  // Fetch historical data when selected period changes or on initial load
  useEffect(() => {
    if (hasAccess && pvSystemId && !checkingAccess) {
      fetchHistoricalData(selectedChartPeriod);
    }
  }, [selectedChartPeriod, pvSystemId, hasAccess, checkingAccess]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchAllData();
    fetchHistoricalData(selectedChartPeriod);
  };

  // Extract Key Data Points (with null checks) ---

  const systemIsOnline = (consolidatedDailyData?.current_power_w ?? 0) > 0;
  const latestErrorMessages: any[] = []; // No longer using error messages

  // Determine system status: offline, warning, or online
  const systemStatus = !systemIsOnline
    ? "offline"
    : latestErrorMessages.length > 0
    ? "warning"
    : "online";

  // Define status colors
  const statusColors = {
    online: "#4CAF50", // Green
    warning: "#FF9800", // Orange for warning state
    offline: "#F44336", // Red
  };


  // Dashboard data for swipeable cards - moved after variable declarations
  const dashboardData = [
    {
      id: "today",
      title: "Today",
      metrics: [
        {
          label: "Current Power",
          value:
          extractPowerFromConsolidatedData(consolidatedDailyData)
    
        },
        {
          label: "Energy",
          value:
          extractEnergyFromConsolidatedData(consolidatedDailyData)
        },
        {
          label: "CO₂ Saved",
          value:
          extractCO2FromConsolidatedData(consolidatedDailyData) + " kg"
        },
        {
          label: "Earnings",
          value: "$" + extractEarningsFromConsolidatedData(consolidatedDailyData)
        },
        {
          label: "Expected Earnings",
          value: `$${(expectedEarnings?.earnings_avg ?? 0).toFixed(2)}`,
        },
      ],
    },
    {
      id: "week",
      title: "Week",
      metrics: [
        {
          label: "Current Power",
          value:
          extractPowerFromConsolidatedData(consolidatedDailyData)
        }, 
        {
          label: "Weekly Energy",
          value:
          extractEnergyFromConsolidatedData(consolidatedWeeklyData)
        },
        {
          label: "CO₂ Saved",
          value:
          extractCO2FromConsolidatedData(consolidatedWeeklyData) + " kg"
        },
        {
          label: "Earnings",
          value: "$" + extractEarningsFromConsolidatedData(consolidatedWeeklyData)
        },
        {
          label: "Expected Earnings",
          value: `$${((expectedEarnings?.earnings_avg ?? 0) * 7).toFixed(2)}`
        },
      ],
    },
    {
      id: "month",
      title: "Month",
      metrics: [
        {
          label: "Monthly Energy",
          value:
          extractEnergyFromConsolidatedData(consolidatedMonthlyData)
        },
        {
          label: "Avg Daily Energy",
          value:
          extractEnergyFromConsolidatedData(consolidatedMonthlyData)
        },
        {
          label: "CO₂ Saved",
          value:
          extractCO2FromConsolidatedData(consolidatedMonthlyData) + " kg"
        },
        {
          label: "Earnings",
          value: "$" + extractEarningsFromConsolidatedData(consolidatedMonthlyData) 
        },
        {
          label: "Expected Earnings",
          value: `$${((expectedEarnings?.earnings_avg ?? 0) * 30).toFixed(2)}`
        },
      ],
    },
    {
      id: "year",
      title: "Year",
      metrics: [
        {
          label: "Yearly Energy",
          value:
          extractEnergyFromConsolidatedData(consolidatedYearlyData)
        },
        {
          label: "Avg Monthly Energy",
          value:
          extractEnergyFromConsolidatedData(consolidatedYearlyData)
        },
        {
          label: "CO₂ Saved",
          value:
          extractCO2FromConsolidatedData(consolidatedYearlyData) + " kg"
        },
        {
          label: "Earnings",
          value: "$" + extractEarningsFromConsolidatedData(consolidatedYearlyData)  
        },
        {
          label: "Expected Earnings",
          value: `$${((expectedEarnings?.earnings_avg ?? 0) * 365).toFixed(2)}`
        },
      ],
    },
  ];

  // Render dashboard time period indicator
  const DashboardPeriodIndicator = () => {
    return (
      <View style={styles.periodSelectorContainer}>
        {dashboardData.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={[
              styles.periodButton,
              selectedDashboardPeriod === item.id && styles.periodButtonActive,
            ]}
            onPress={() => {
              setSelectedDashboardPeriod(
                item.id as "today" | "week" | "month" | "year"
              );
              // Find index of the item
              const index = dashboardData.findIndex(
                (data) => data.id === item.id
              );
              dashboardFlatListRef.current?.scrollToIndex({
                animated: true,
                index,
              });
            }}
          >
            <ThemedText
              style={[
                styles.periodButtonText,
                selectedDashboardPeriod === item.id &&
                  styles.periodButtonTextActive,
              ]}
            >
              {item.title}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  // Render a dashboard card
  /*
  const renderDashboardCard = ({
    item,
  }: {
    item: (typeof dashboardData)[0];
  }) => {
    return (
      <View
        style={{
          width: dashboardSectionWidth,
          paddingHorizontal: 5,
        }}
      >
        <View style={styles.kpiContainer}>
          {item.metrics.map((metric, index) => (
            <View
              key={index}
              style={[
                styles.kpiItem,
                { backgroundColor: isDarkMode ? colors.background : "#f8f8f8" },
              ]}
            >
              <ThemedText
                style={styles.kpiLabel}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {metric.label}
              </ThemedText>
              <ThemedText
                style={[styles.kpiValue, { color: colors.primary }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {metric.value}
              </ThemedText>
            </View>
          ))}
        </View>
      </View>
    );
  };
  */
  const renderDashboardCard = ({
    item,
  }: {
    item: (typeof dashboardData)[0];
  }) => {
    return (
      <View
        style={{
          width: dashboardSectionWidth,
          paddingHorizontal: 5,
        }}
      >
        <View style={styles.kpiContainerCustom}>
          {/* Left Column: 3 smaller items */}
          <View style={styles.leftColumn}>
            {item.metrics.slice(0, 3).map((metric, index) => (
              <View
                key={index}
                style={[
                  styles.kpiItemSmall,
                  { backgroundColor: isDarkMode ? colors.background : "#f8f8f8" },
                ]}
              >
                <ThemedText style={styles.kpiLabel} numberOfLines={1} ellipsizeMode="tail">
                  {metric.label}
                </ThemedText>
                <ThemedText style={[styles.kpiValue, { color: colors.primary }]} numberOfLines={1} ellipsizeMode="tail">
                  {metric.value}
                </ThemedText>
              </View>
            ))}
          </View>
  
          {/* Right Column: 2 larger items */}
          <View style={styles.rightColumn}>
            {item.metrics.slice(3).map((metric, index) => (
              <View
                key={index}
                style={[
                  styles.kpiItemLarge,
                  { backgroundColor: isDarkMode ? colors.background : "#f8f8f8" },
                ]}
              >
                <ThemedText style={styles.kpiLabelLarge} numberOfLines={1} ellipsizeMode="tail">
                  {metric.label}
                </ThemedText>
                <ThemedText style={[styles.kpiValueLarge, { color: colors.primary }]} numberOfLines={1} ellipsizeMode="tail">
                  {metric.value}
                </ThemedText>
              </View>
            ))}
          </View>
        </View>
      </View>
    );
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
        edges={["left", "right"]}
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
        edges={["left", "right"]}
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

  // Charts Section
  const ChartPeriodSelector = () => {
      return (
      <View style={styles.periodSelectorContainer}>
        <TouchableOpacity
          style={[
            styles.periodButton,
            selectedChartPeriod === "day" && styles.periodButtonActive,
          ]}
          onPress={() => setSelectedChartPeriod("day")}
        >
          <ThemedText
            style={[
              styles.periodButtonText,
              selectedChartPeriod === "day" && styles.periodButtonTextActive,
            ]}
          >
            Day
          </ThemedText>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.periodButton,
            selectedChartPeriod === "week" && styles.periodButtonActive,
          ]}
          onPress={() => setSelectedChartPeriod("week")}
        >
          <ThemedText
            style={[
              styles.periodButtonText,
              selectedChartPeriod === "week" && styles.periodButtonTextActive,
            ]}
          >
            Week
          </ThemedText>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.periodButton,
            selectedChartPeriod === "month" && styles.periodButtonActive,
          ]}
          onPress={() => setSelectedChartPeriod("month")}
        >
          <ThemedText
            style={[
              styles.periodButtonText,
              selectedChartPeriod === "month" && styles.periodButtonTextActive,
            ]}
          >
            Month
          </ThemedText>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.periodButton,
            selectedChartPeriod === "year" && styles.periodButtonActive,
          ]}
          onPress={() => setSelectedChartPeriod("year")}
        >
          <ThemedText
            style={[
              styles.periodButtonText,
              selectedChartPeriod === "year" && styles.periodButtonTextActive,
            ]}
          >
            Year
          </ThemedText>
        </TouchableOpacity>
      </View>
    );
  };

  // Simplified Energy Chart Component that works for all time periods
  const EnergyChart = () => {
    const screenWidth = Dimensions.get("window").width - 40; // Accounting for margins
    const screenHeight = Dimensions.get('window').height;
    const [energySectionWidth, setEnergySectionWidth] = useState<number>(0);
    const [energySectionHeight, setEnergySectionHeight] = useState<number>(0);

    if (chartLoading) {
      return (
        <View style={styles.chartLoadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <ThemedText style={styles.chartLoadingText}>
            Loading chart data...
          </ThemedText>
        </View>
      );
    }

         // Handle yearly data differently
     if (selectedChartPeriod === "year") {
       if (!yearlyMonthlyData || yearlyMonthlyData.length === 0) {
         return (
           <View style={styles.chartNoDataContainer}>
             <Ionicons
               name="bar-chart-outline"
               size={48}
               color={isDarkMode ? "#888" : "#aaaaaa"}
             />
             <ThemedText style={styles.chartNoDataText}>
               No yearly data available
             </ThemedText>
           </View>
         );
       }
     } else {
       if (
         !energyHistData ||
         !energyHistData.data ||
         energyHistData.data.length === 0
       ) {
         return (
           <View style={styles.chartNoDataContainer}>
             <Ionicons
               name="bar-chart-outline"
               size={48}
               color={isDarkMode ? "#888" : "#aaaaaa"}
             />
             <ThemedText style={styles.chartNoDataText}>
               No energy data available for this period
             </ThemedText>
           </View>
         );
       }
     }

         // Sort data by date to ensure chronological order (only for non-yearly views)
     const sortedData = selectedChartPeriod === "year" ? [] : [...energyHistData!.data].sort(
       (a, b) =>
         new Date(a.logDateTime).getTime() - new Date(b.logDateTime).getTime()
     );
     
     // Log data for daily chart
     if (selectedChartPeriod === "day") {
       console.log('🕐 DAILY CHART - Sorted data for rendering:', sortedData);
       console.log('🕐 DAILY CHART - Data count after sorting:', sortedData.length);
     }

    // Format labels based on period type
    const getFormattedLabel = (
      dateStr: string,
      index: number,
      total: number
    ) => {
      const date = new Date(dateStr);

      // Skip some labels for better spacing when we have many data points
      if (total > 12 && index % Math.ceil(total / 4) !== 0) {
        return "";
        }

        if (selectedChartPeriod === "day") {
        // Format for more granular time data in day view (hh:mm format)
        const hours = date.getHours();
        const minutes = date.getMinutes();
        // Always show in HH:MM format
        return hours.toString().padStart(2, "0") + ":" + minutes.toString().padStart(2, "0");
             } else if (selectedChartPeriod === "week") {
              console.log('DATE123', date);
         const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
         return weekdays[date.getUTCDay()];
       } else if (selectedChartPeriod === "month") {
        return date.getDate() + "/" + (date.getMonth() + 1);
      } else {
        // year
        return date.toLocaleString("default", { month: "short" });
        }
    };

         // Process data for the chart
          let chartData;
     
     if (selectedChartPeriod === "year") {
       // Use yearly monthly data
       chartData = {
         labels: yearlyMonthlyData!.map((item, index) => {
           // Only show labels for 1st, 4th, 8th, and 12th months (indices 0, 3, 7, 11)
           if (index === 0 || index === 3 || index === 7 || index === 11) {
             return item.month;
           }
           return ""; // Empty string for months we don't want to show
         }),
         datasets: [
           {
             data: yearlyMonthlyData!.map(item => item.total),
             color: (opacity = 1) => `rgba(255, 122, 69, ${opacity})`,
             strokeWidth: 3,
             withDots: false,
           },
         ],
       };
     } else if (selectedChartPeriod === "month") {
        // Special handling for monthly view (5 weeks of data)
        const validData = sortedData.filter(
          (item) => !isNaN(new Date(item.logDateTime).getTime())
        );
        
        // Group daily data into 5 weekly buckets
        interface WeeklyBucket {
          total: number;
          startDate: Date;
          endDate: Date;
        }
        
        const weeklyBuckets: WeeklyBucket[] = [];
        
        // Calculate the start of each week (Monday) and create buckets
        const currentMonday = getFirstDayOfWeek(new Date());
        for (let i = 0; i < 5; i++) {
          const weekStart = new Date(currentMonday);
          weekStart.setDate(weekStart.getDate() - (4 - i) * 7); // Go back 4, 3, 2, 1, 0 weeks
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 6); // Sunday of that week
          
          weeklyBuckets.push({
            total: 0,
            startDate: weekStart,
            endDate: weekEnd
          });
        }
        
        // Aggregate daily data into weekly totals
        validData.forEach((item) => {
          const itemDate = new Date(item.logDateTime);
          const value = findChannelValue(item.channels, "EnergyProductionTotal");
          const kwhValue = value !== null ? Math.max(0, value / 1000) : 0;
          
          // Find which week this day belongs to
          for (let i = 0; i < 5; i++) {
            if (itemDate >= weeklyBuckets[i].startDate && itemDate <= weeklyBuckets[i].endDate) {
              weeklyBuckets[i].total += kwhValue;
              break;
            }
          }
        });
        
        // Create chart data with week labels
        chartData = {
          labels: weeklyBuckets.map((bucket) => {
            const startMonth = bucket.startDate.getMonth() + 1;
            const startDay = bucket.startDate.getDate();
            const endMonth = bucket.endDate.getMonth() + 1;
            const endDay = bucket.endDate.getDate();
            
            if (startMonth === endMonth) {
              return `${startMonth}/${startDay}-${endDay}`;
            } else {
              return `${startMonth}/${startDay}-${endMonth}/${endDay}`;
            }
          }),
          datasets: [
            {
              data: weeklyBuckets.map(bucket => bucket.total),
              color: (opacity = 1) => `rgba(255, 122, 69, ${opacity})`,
              strokeWidth: 3,
              withDots: false,
            },
          ],
        };
     } else {
       // Original processing for other periods
       const validData = sortedData.filter(
         (item) => !isNaN(new Date(item.logDateTime).getTime())
       );
       
       chartData = {
         labels: validData.map((item, index) =>
           getFormattedLabel(item.logDateTime, index, validData.length)
         ),
         datasets: [
           {
             data: validData.map((item) => {
               const value = findChannelValue(
                 item.channels,
                 "EnergyProductionTotal"
               );
       
               // For day view with historical data, we should properly handle the values
               if (selectedChartPeriod === "day" && value !== null) {
                 // Historical data might be in Wh, convert to kWh
                 return Math.max(0, value / 1000);
               } else if (value !== null) {
                 // For other periods, use the existing conversion
                 return Math.max(0, value / 1000); // Convert to kWh
               } else {
                 return 0;
               }
             }),
             color: (opacity = 1) => `rgba(255, 122, 69, ${opacity})`, // Vibrant orange line color
             strokeWidth: 3,
             // Add dots for fewer data points, hide them when there are many
             withDots: false,
           },
         ],
       };
     }

     // Log final chart data for daily view
     if (selectedChartPeriod === "day") {
       console.log('🕐 DAILY CHART - Final chart data structure:', chartData);
       console.log('🕐 DAILY CHART - Chart labels:', chartData.labels);
       console.log('🕐 DAILY CHART - Chart values:', chartData.datasets[0].data);
     }

const chartConfig = {
  backgroundGradientFrom: isDarkMode ? colors.card : "#fff",
  backgroundGradientTo: isDarkMode ? colors.card : "#fff",
  decimalPlaces: 1,
  color: (opacity: number = 1) => `rgba(255, 122, 69, ${opacity})`, // Match the line color
  fillShadowGradientFrom: 'rgba(255, 122, 69, 0.8)',
  fillShadowGradientTo: 'rgba(58, 123, 213, 0.2)',
  fillShadowGradientOpacity: 1,
 // fillShadowGradient: 1,
  labelColor: (opacity: number = 1) =>
    isDarkMode
      ? `rgba(255, 255, 255, ${opacity})`
      : `rgba(0, 0, 0, ${opacity})`,

  propsForLabels: {
    fontSize: selectedChartPeriod === "year" ? 8.5 : 10,
    fontWeight: "400",
  },

  propsForBackgroundLines: {
    strokeDasharray: "",
    stroke: isDarkMode ? `rgba(255, 255, 255, 0.15)` : `rgba(0, 0, 0, 0.15)`,
    strokeWidth: 1,
  },

  barPercentage: selectedChartPeriod === "year" ? 0.55 : selectedChartPeriod === "week" ? 0.75 : 1,

  formatYLabel: (value: string) => {
    const num = parseFloat(value);
    if (num >= 1000) {
      const kValue = num / 1000;
      return kValue % 1 === 0 ? `${kValue}k` : `${kValue.toFixed(1)}k`;
    }
    return num < 10 ? num.toFixed(1) : Math.round(num).toString();
  },

  formatXLabel: (label: string) => label,

  style: {
    borderRadius: 16,
  },

 
};

 // Determine chart title based on period
 const chartTitle =
   selectedChartPeriod === "day"
     ? "Daily Power Flow (kW)"
     : selectedChartPeriod === "week"
     ? "Weekly Energy Production (kWh)"
     : selectedChartPeriod === "month"
     ? "Monthly Energy Production (5 Weeks)"
     : "Yearly Energy Production (12 Months)";



return (
  <View style={styles.chartContainer}
  onLayout={(event) => {
    const { width, height } = event.nativeEvent.layout;
    setEnergySectionWidth(width);
    setEnergySectionHeight(height);
  }}
  >
    <View style={styles.chartHeader}>
      <ThemedText style={styles.chartTitle}>{chartTitle}</ThemedText>
     
    </View>
    {energySectionWidth !== null && (
      selectedChartPeriod === "week" || selectedChartPeriod === "month" || selectedChartPeriod === "year" ? (
        <BarChart
          data={chartData}
          width={energySectionWidth}
          height={screenHeight * 0.5}
          chartConfig={chartConfig}
          style={styles.chart}
          yAxisLabel=""
          fromZero={true}
          yAxisSuffix=" kWh"
          withInnerLines={true}
          segments={5}
          yAxisInterval={1}
          showBarTops={false}
          showValuesOnTopOfBars={false}
        />
      ) : (
        <LineChart
          data={chartData}
          width={energySectionWidth}
          height={screenHeight * 0.5}
          chartConfig={chartConfig}
          bezier
          withShadow={true}
          style={styles.chart}
          withVerticalLines={true}
          withHorizontalLines={true}
          fromZero={true}
          yAxisSuffix=" kW"
          withInnerLines={true}
          segments={5}
          yAxisInterval={1}
        />
      )
    )}
      </View>
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
  const TopNavigationBar = ({ 
    activeTab, 
    setActiveTab 
  }: { 
    activeTab: 'overview' | 'performance' | 'system', 
    setActiveTab: React.Dispatch<React.SetStateAction<'overview' | 'performance' | 'system'>> 
  }) => {
   
    
    const tabs = [
      { id: 'overview', label: 'Overview' },
      { id: 'performance', label: 'Performance' },
      { id: 'system', label: 'System Details' },
    ];
    
    return (
      <View style={[styles.navBarContainer, { backgroundColor: isDarkMode ? colors.card : '#fff' }]}>
        {tabs.map((tab) => (
          <TouchableOpacity
            key={tab.id}
            style={[
              styles.navTab,
              activeTab === tab.id && { borderBottomColor: colors.primary, borderBottomWidth: 2 }
            ]}
            onPress={() => setActiveTab(tab.id as 'overview' | 'performance' | 'system')}
          >
            <ThemedText 
              style={[
                styles.navTabText, 
                activeTab === tab.id && { color: colors.primary, fontWeight: '600' }
              ]}
            >
              {tab.label}
            </ThemedText>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  // --- Render Dashboard ---
  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        { backgroundColor: isDarkMode ? colors.background : "#f5f5f5" },
      ]}
      edges={["left", "right"]}
    >
      {/* Configure Header Title Dynamically */}
      <Stack.Screen
        options={{
          headerShown: true,
          title: pvSystemDetails.name || "System Details",
          headerStyle: {
            backgroundColor: isDarkMode ? colors.background : "#f5f5f5",
          },
          contentStyle: { 
            paddingBottom: 0,
          },
          headerShadowVisible: true,
          headerTintColor: colors.text,
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => router.push("/dashboard")}
              style={{ marginLeft: 16, padding: 4, marginRight: 16 }}
            >
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
          ),
      
        }}
      />
      {/* Add the Navigation Bar */}
      <TopNavigationBar activeTab={activeTab as 'overview' | 'performance' | 'system'} setActiveTab={setActiveTab as React.Dispatch<React.SetStateAction<'overview' | 'performance' | 'system'>>}   />
      
      {/* Status indicator moved outside ScrollView to prevent re-rendering */}
      {pvSystemId && (
        <View style={{
          flexDirection: 'row',
          justifyContent: 'flex-start',
          alignItems: 'center',
          backgroundColor: 'transparent', 
          paddingHorizontal: 16, 
          paddingVertical: 4,
          marginBottom: 0
        }}>
          <StatusIcon 
            systemId={pvSystemId as string} 
            key={`status-${pvSystemId}`} 
          />
        </View>
      )}
      
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
        

        {/* OVERVIEW TAB CONTENT */}
        {activeTab === 'overview' && (
          <>
            {/* System Dashboard Section */}
        <Animated.View entering={FadeInDown.springify()}>
          {/* Image section */}
          <View style={styles.imageContainer}>
            {pvSystemDetails.pictureURL ? (
              <Image
                source={{ uri: pvSystemDetails.pictureURL }}
                style={styles.image}
                resizeMode="cover"
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
            <Animated.View
              entering={FadeInUp.delay(100).springify()}
              style={[
                styles.section,
                { backgroundColor: isDarkMode ? colors.card : "#fff", padding: 16 },
              ]}
              onLayout={(event) => {
                const { width } = event.nativeEvent.layout;
                setDashboardSectionWidth(width - 32);
              }}
            >
              
              <ThemedText style={styles.sectionTitle}>System Dashboard</ThemedText>

              {/* Period selector above the cards */}
              <DashboardPeriodIndicator />

              <FlatList
                ref={dashboardFlatListRef}
                data={dashboardData}
                renderItem={renderDashboardCard}
                keyExtractor={(item) => item.id}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                snapToInterval={dashboardSectionWidth}
                snapToAlignment="start"
                decelerationRate={0.3}
                contentContainerStyle={{width: dashboardSectionWidth * dashboardData.length }}
                bounces={false}
                onMomentumScrollEnd={(event) => {
                  const contentOffset = event.nativeEvent.contentOffset;
                  const viewSize = event.nativeEvent.layoutMeasurement;
                  const pageNum = Math.floor(contentOffset.x / viewSize.width);
                  setSelectedDashboardPeriod(
                    dashboardData[pageNum].id as "today" | "week" | "month" | "year"
                  );
                }}
                scrollEnabled={false}
              />
            </Animated.View>

            {/* Weather Widget */}
            <WeatherWidget pvSystemId={pvSystemId}/>

            {/* Power Flow Diagram */}
            {/*
            <Animated.View entering={FadeInUp.delay(150).springify()}>
              <PowerFlowDiagram />
            </Animated.View>
            */}
          </>
        )}

        {/* PERFORMANCE TAB CONTENT */}
        {activeTab === 'performance' && (
          <>
            {/* Charts Section */}
            <Animated.View
              entering={FadeInUp.delay(100).springify()}
              style={[
                styles.section2,
                { backgroundColor: isDarkMode ? colors.card : "#fff" },
                {marginTop: 15}
              ]}
            >
              <ThemedText style={styles.sectionTitle}>
                Performance Trends
              </ThemedText>
              <ChartPeriodSelector />

              {/* Energy chart adapts based on selected period */}
              <EnergyChart />
            </Animated.View>
          </>
        )}

        {/* SYSTEM DETAILS TAB CONTENT */}
        {activeTab === 'system' && (
          <>
            {/* Devices Section */}
            <Animated.View
              entering={FadeInUp.delay(100).springify()}
              style={[
                styles.section,
                { backgroundColor: isDarkMode ? colors.card : "#fff" },
                {marginTop: 15}
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

            {/* Maintenance Log Section */}
            <Animated.View
              entering={FadeInUp.delay(200).springify()}
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

            {/* Basic System Info Section */}
            <Animated.View
              entering={FadeInUp.delay(300).springify()}
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

            {/* Location Section */}
            <Animated.View
              entering={FadeInUp.delay(400).springify()}
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

            {/* Error Messages Section removed - no longer using getPvSystemMessages */}
          </>
        )}
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
    paddingBottom: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
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
  section2: {
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
  kpiContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginTop: 8,
    paddingHorizontal: 5,
  },
  kpiItem: {
    width: "45%",
    paddingVertical: 10,
    paddingHorizontal: 3,
    marginBottom: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  kpiLabel: {
    fontSize: 13,
    marginBottom: 4,
    opacity: 0.7,
    textAlign: "center",
    width: "100%",
    flexShrink: 1,
  },
  kpiValue: {
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "center",
    width: "100%",
    flexShrink: 1,
  },
  weatherMainContent: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    paddingBottom: 8,
  },

  weatherNoDataContent: {
    alignItems: "center",
    justifyContent: "center",
    padding: 30,
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
    textAlign: "right",
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
  demoButton: {
    marginLeft: "auto",
    backgroundColor: "rgba(255,152,0,0.1)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  errorItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.05)",
  },
  errorHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  errorItemTitle: {
    fontWeight: "bold",
    marginLeft: 8,
  },
  errorDetails: {
    marginTop: 4,
    marginLeft: 24,
    backgroundColor: "rgba(0,0,0,0.03)",
    borderRadius: 4,
    padding: 8,
  },
  errorDetail: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  errorDetailLabel: {
    fontWeight: "bold",
    flex: 1,
  },
  errorDetailValue: {
    flex: 2,
  },
  errorTimestamp: {
    fontSize: 12,
    opacity: 0.5,
    textAlign: "right",
  },
  emptyErrorState: {
    padding: 16,
    alignItems: "center",
  },
  // Chart Styles
  chartLoadingContainer: {
    height: 220,
    justifyContent: "center",
    alignItems: "center",
    marginVertical: 16,
    backgroundColor: "rgba(0,0,0,0.03)",
    borderRadius: 8,
  },
  chartLoadingText: {
    marginTop: 10,
    fontSize: 14,
    opacity: 0.7,
  },
  chartNoDataContainer: {
    height: 220,
    justifyContent: "center",
    alignItems: "center",
    marginVertical: 16,
    backgroundColor: "rgba(0,0,0,0.03)",
    borderRadius: 8,
  },
  chartNoDataText: {
    marginTop: 10,
    fontSize: 14,
    opacity: 0.7,
    textAlign: "center",
  },
  chartContainer: {
    backgroundColor: "transparent",
    borderRadius: 8,
    paddingTop: 16,
   // paddingVertical: 16,
    marginTop: 8,
  //  flex: 1,
  },
  chartHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: "bold",
  },
  chart: {
    marginTop: 8,
  //  marginVertical: 8,
    borderRadius: 8,
  },
  periodSelectorContainer: {
    flexDirection: "row",
    justifyContent: "center",
    marginBottom: 12,
    marginTop: 4,
    paddingVertical: 8,
    backgroundColor: "rgba(0,0,0,0.03)",
    borderRadius: 8,
  },
  periodButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    marginHorizontal: 5,
  },
  periodButtonActive: {
    backgroundColor: "rgba(0,0,0,0.1)",
  },
  periodButtonText: {
    fontSize: 13,
  },
  periodButtonTextActive: {
    fontWeight: "bold",
  },
  dashboardCardHeader: {
    marginBottom: 12,
  },
  dashboardCardTitle: {
    fontSize: 18,
    fontWeight: "500",
    textAlign: "center",
    marginVertical: 8,
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
  navBarContainer: {
    flexDirection: 'row',
    height: 48,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
    marginBottom: 2,
  },
  navTab: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
  },
  navTabText: {
    fontSize: 14,
    fontWeight: '500',
  },
  kpiContainerCustom: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  
  leftColumn: {
    flex: 1,
    justifyContent: "space-between",
  },
  
  rightColumn: {
    flex: 1,
    justifyContent: "space-between",
  },
  
  kpiItemSmall: {
    height: 70, // adjust to fit your screen
    marginBottom: 8,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  
  kpiItemLarge: {
    height: 109,
    marginBottom: 8,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center", // <-- center vertically
  },
  kpiLabelLarge: {
    fontSize: 15,
    marginBottom: 6,
    opacity: 0.75,
    textAlign: "center",
    width: "100%",
    flexShrink: 1,
  },
  
  kpiValueLarge: {
    fontSize: 22,
    fontWeight: "bold",
    textAlign: "center",
    width: "100%",
    flexShrink: 1,
  },
  peakInfo: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 4,

  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
});


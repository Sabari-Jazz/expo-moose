import Constants from 'expo-constants';
import { API_BASE_URL, API_URL, ENDPOINTS } from '@/constants/api';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

// JWT Token Storage Constants
const JWT_TOKEN_STORAGE_KEY = 'jwt_token_cache';
const JWT_TOKEN_LIFETIME_MS = 50 * 60 * 1000; // 50 minutes in milliseconds (tokens usually last 1 hour)

// Interface for cached JWT token
interface CachedJwtToken {
  token: string;
  timestamp: number; // When the token was cached (milliseconds since epoch)
}

// === Interfaces based on API Documentation ===

// --- Common Structures ---
export interface ApiChannel<T = number | string | WeatherDaylightValue | WeatherTempValue | null> {
  channelName: string;
  channelType: string;
  unit: string;
  value: T; // Use a generic type for flexibility
}

export interface ApiErrorResponse {
  responseError: number;
  responseMessage: string;
}

// --- Specific Endpoint Response Interfaces ---

// Flow Data (Real-time) - Based on your example
export interface FlowDataChannel extends Omit<ApiChannel, 'value'> {
  value: number | null; // Flow data values seem to be numbers or null
}

export interface FlowDataResponse {
  pvSystemId: string;
  status: {
    isOnline: boolean;
    battMode?: number | string | null; // battMode can be number or string like "1.0"
  };
  data: {
    logDateTime: string; // ISO 8601 timestamp string
    channels: FlowDataChannel[];
  };
}

// Aggregated Data - Based on documentation [cite: 269, 273]
export interface AggregatedDataChannel extends Omit<ApiChannel, 'value'> {
   value: number | null; // Aggregated values are typically numbers or null
}

export interface AggregatedDataItem {
  logDateTime: string; // Can be "yyyy", "yyyy-MM", "yyyy-MM-dd", or "total"
  channels: AggregatedDataChannel[];
}

export interface AggregatedDataResponse {
  pvSystemId: string;
  deviceId?: string | null; // Present for device-specific calls
  data: AggregatedDataItem[];
}

// Historical Data - Based on documentation [cite: 313, 330, 363]
export interface HistoricalDataChannel extends ApiChannel {
  // value can be number (most energy/power), string (BattMode), or null
}

export interface HistoricalDataItem {
  logDateTime: string; // ISO 8601 timestamp string
  logDuration: number; // Duration in seconds
  channels: HistoricalDataChannel[];
}

export interface HistoricalDataResponse {
  pvSystemId: string;
  deviceId: string | null; // Null for system-level calls
  data: HistoricalDataItem[];
}

// System/Device Messages - Based on documentation [cite: 1494, 1512]
export interface SystemMessage {
  pvSystemId: string;
  deviceId: string | null; // Null if it's a system-level message
  stateType: 'Error' | 'Event' | string; // Allow other strings for flexibility
  stateSeverity: 'Error' | 'Warning' | 'Information' | string; // Allow other strings
  stateCode: number;
  logDateTime: string; // ISO 8601 timestamp string
  text: string;
}

// PV System Metadata - Based on documentation [cite: 711, 713]
export interface PvSystemAddress {
  country: string | null;
  zipCode: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
}

export interface PvSystemMetadata {
  pvSystemId: string;
  name: string;
  address: PvSystemAddress;
  pictureURL: string | null;
  peakPower: number | null;
  installationDate: string; // ISO 8601 timestamp string
  lastImport: string; // ISO 8601 timestamp string
  meteoData: 'pro' | 'light' | null; // Or potentially other strings
  timeZone: string; // Olson format
}

export interface PvSystemsListResponse {
  pvSystems: PvSystemMetadata[];
  // links object for pagination omitted for brevity, handle if needed
}

// Device Metadata - Based on documentation [cite: 211, 216, 746, 748, 751]
export interface DeviceFirmware {
  updateAvailable: boolean | null;
  installedVersion: string | null;
  availableVersion: string | null;
}

export interface DeviceSensorInfo {
    sensorName: string | null;
    sensorType: string | null; // e.g., "Insolation", "Temperature" [cite: 760]
    isActive: boolean;
    activationDate: string | null;
    deactivationDate: string | null;
}

export interface BaseDeviceMetadata {
    deviceId: string;
    deviceName: string;
    deviceManufacturer: string | null;
    serialNumber: string | null;
    dataloggerId: string | null; // Link to the datalogger device
    firmware: DeviceFirmware | null;
    isActive: boolean;
    activationDate: string | null; // ISO 8601 timestamp string
    deactivationDate: string | null; // ISO 8601 timestamp string
}

export interface InverterMetadata extends BaseDeviceMetadata {
    deviceType: 'Inverter';
    deviceTypeDetails: string | null;
    nodeType: number | null;
    numberMPPTrackers: number | null;
    numberPhases: number | null;
    peakPower: { [key: string]: number | null }; // e.g., { dc1: 5000, dc2: null }
    nominalAcPower: number | null;
}

export interface BatteryMetadata extends BaseDeviceMetadata {
    deviceType: 'Battery';
    maxChargePower: number | null;
    maxDischargePower: number | null;
    capacity: number | null; // Wh? Documentation Example shows 9600 [cite: 755]
    maxSOC: number | null; // Percentage
    minSOC: number | null; // Percentage
}

export interface SmartMeterMetadata extends BaseDeviceMetadata {
    deviceType: 'SmartMeter';
    deviceCategory: string | null; // e.g., "Primary Meter" [cite: 759]
    deviceLocation: string | null; // e.g., "Grid" [cite: 759]
}

export interface OhmpilotMetadata extends BaseDeviceMetadata {
    deviceType: 'Ohmpilot';
    sensors: DeviceSensorInfo[] | null;
}

export interface SensorMetadata extends BaseDeviceMetadata {
    deviceType: 'Sensor';
    sensors: DeviceSensorInfo[] | null;
}

export interface EVChargerMetadata extends BaseDeviceMetadata {
    deviceType: 'EVCharger';
    isOnline?: boolean | null; // Added based on example [cite: 755]
}

export interface DataloggerMetadata extends BaseDeviceMetadata {
    deviceType: 'Datalogger';
    isOnline: boolean | null;
}

// Discriminated union for device metadata
export type DeviceMetadata =
    | InverterMetadata
    | BatteryMetadata
    | SmartMeterMetadata
    | OhmpilotMetadata
    | SensorMetadata
    | EVChargerMetadata
    | DataloggerMetadata;

export interface DevicesListResponse {
  devices: DeviceMetadata[];
  // links object for pagination omitted for brevity, handle if needed
}

// Weather Data - Based on documentation [cite: 381, 934]
export interface WeatherDaylightValue {
    sunrise: string | null; // ISO 8601 timestamp string or null
    sunset: string | null; // ISO 8601 timestamp string or null
}
export interface WeatherTempValue {
    temperatureMin: number | null;
    temperatureMax: number | null;
}
export interface WeatherChannel extends ApiChannel {
    value: number | string | WeatherDaylightValue | WeatherTempValue | null;
    // unit: string | null; // No longer needed here, inherited from corrected ApiChannel
}
export interface CurrentWeatherData {
    logDateTime: string; // ISO 8601 timestamp string
    channels: WeatherChannel[]; 
}
export interface CurrentWeatherResponse {
    pvSystemId: string;
    data: CurrentWeatherData;
}


// --- Parameter Interfaces (for function arguments) ---
export interface AggregatedDataParams {
    channel?: string | string[];
    from?: string; // YYYY, YYYY-MM, YYYY-MM-DD
    to?: string; // YYYY, YYYY-MM, YYYY-MM-DD
    duration?: number; // years, months, or days depending on 'from'
    period?: 'total' | 'years' | string; // YYYY or YYYY-MM
    offset?: number;
    limit?: number;
}

export interface HistoricalDataParams {
    channel?: string | string[];
    from: string; // ISO-8601 timestamp
    to: string; // ISO-8601 timestamp
    timezone?: 'local' | 'zulu';
    offset?: number;
    limit?: number;
}

export interface SystemMessagesParams {
    from?: string; // ISO-8601 timestamp
    to?: string; // ISO-8601 timestamp
    statetype?: 'Error' | 'Event';
    stateseverity?: 'Error' | 'Warning' | 'Information';
    statecode?: number;
    type?: string | string[]; // device type filter
    timezone?: 'local' | 'zulu';
    offset?: number;
    limit?: number;
}

export interface WeatherParams {
    channel?: string | string[];
    timezone?: 'local' | 'zulu';
}

// --- Helper function to build query strings ---
function buildQueryString(params: Record<string, any>): string {
  const query = Object.entries(params)
    .filter(([_, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value instanceof Array ? value.join(',') : value)}`)
    .join('&');
  return query ? `?${query}` : '';
}

// JWT Token Caching Functions
const saveJwtToken = async (token: string): Promise<void> => {
  const tokenData: CachedJwtToken = {
    token,
    timestamp: Date.now(),
  };
  try {
    await AsyncStorage.setItem(JWT_TOKEN_STORAGE_KEY, JSON.stringify(tokenData));
    console.log('JWT token cached successfully');
  } catch (error) {
    console.error('Error saving JWT token to cache:', error);
  }
};

const loadJwtToken = async (): Promise<CachedJwtToken | null> => {
  try {
    const tokenData = await AsyncStorage.getItem(JWT_TOKEN_STORAGE_KEY);
    if (!tokenData) return null;
    
    return JSON.parse(tokenData) as CachedJwtToken;
  } catch (error) {
    console.error('Error loading JWT token from cache:', error);
    return null;
  }
};

const isTokenValid = (tokenData: CachedJwtToken): boolean => {
  const now = Date.now();
  const tokenAge = now - tokenData.timestamp;
  return tokenAge < JWT_TOKEN_LIFETIME_MS;
};

// --- Get JWT token for authentication ---
export const getJwtToken = async (): Promise<string> => {
    // First try to use a cached token
    const cachedToken = await loadJwtToken();
    if (cachedToken && isTokenValid(cachedToken)) {
        console.log('Using cached JWT token');
        return cachedToken.token;
    }
    
    console.log('Cached token not available or expired, requesting new token');
    
    try {
        const accessKeyId = Constants.expoConfig?.extra?.solarWebAccessKeyId ||
                           process.env.SOLAR_WEB_ACCESS_KEY_ID ||
                           'FKIA08F3E94E3D064B629EE82A44C8D1D0A6';
        const accessKeyValue = Constants.expoConfig?.extra?.solarWebAccessKeyValue ||
                              process.env.SOLAR_WEB_ACCESS_KEY_VALUE ||
                              '2f62d6f2-77e6-4796-9fd1-5d74b5c6474c';
        const apiBaseUrl = API_BASE_URL;
        const userId = Constants.expoConfig?.extra?.solarWebUserId ||
                      process.env.SOLAR_WEB_USERID ||
                      "monitoring@jazzsolar.com";
        const password = Constants.expoConfig?.extra?.solarWebPassword ||
                        process.env.SOLAR_WEB_PASSWORD ||
                        "solar123";

        const requestHeaders = {
            'Content-Type': 'application/json',
            'AccessKeyId': accessKeyId,
            'AccessKeyValue': accessKeyValue
        };

        console.log(`Requesting JWT from: ${apiBaseUrl}${ENDPOINTS.SOLARWEB.JWT}`);
        const response = await fetch(`${apiBaseUrl}${ENDPOINTS.SOLARWEB.JWT}`, {
            method: 'POST',
            headers: requestHeaders,
            body: JSON.stringify({
                UserId: userId,
                password: password
            })
        });

        if (!response.ok) {
            let errorBody = '';
            try { errorBody = await response.text(); } catch (e) {}
            console.error("JWT Response Status:", response.status, "Body:", errorBody);
            
            // If we have a cached token, use it as fallback even if expired
            // This prevents the app from completely failing during rate limiting
            if (cachedToken) {
                console.log('Using expired token as fallback due to API rate limit');
                return cachedToken.token;
            }
            
            throw new Error(`HTTP error fetching JWT! Status: ${response.status}`);
        }

        const data = await response.json();
        
        // Check for expected JWT token format - based on actual API response
        if (!data.jwtToken) {
            console.error("JWT response missing jwtToken:", data);
            throw new Error("JWT response is missing the jwtToken field");
        }
        
        console.log("JWT Token obtained successfully");
        
        // Cache the new token
        await saveJwtToken(data.jwtToken);
        
        return data.jwtToken;
    } catch (error) {
        console.error("Error obtaining JWT token:", error);
        throw error;
    }
};

export const loginAndGetToken = async (username: string, password: string) => {
  try {
    const response = await axios.post(`${API_BASE_URL}${ENDPOINTS.LOGIN}`, {
      username,
      password,
    });

    const { data } = response;
    
    if (!data.jwtToken) {
      console.error('JWT response missing jwtToken:', data);
      throw new Error('JWT token missing from response');
    }

    return data.jwtToken;
  } catch (error) {
    console.error('Error logging in:', error);
    throw error;
  }
};

// --- Generic API request function (typed with generics) ---
async function apiRequest<T>(
    endpoint: string,
    method: string = 'GET',
    queryParams: Record<string, any> = {},
    body: any = null
): Promise<T> {
    let jwtToken: string | null = null;
    try {
        jwtToken = await getJwtToken();
    } catch (jwtError) {
        console.error("API Request cannot proceed without JWT token.", jwtError);
        // Propagate the error correctly
        if (jwtError instanceof Error) throw jwtError;
        else throw new Error(`JWT Token Acquisition Failed: ${jwtError}`);
    }

    try {
        const accessKeyId = Constants.expoConfig?.extra?.solarWebAccessKeyId ||
                          process.env.SOLAR_WEB_ACCESS_KEY_ID ||
                          'FKIA08F3E94E3D064B629EE82A44C8D1D0A6';
        const accessKeyValue = Constants.expoConfig?.extra?.solarWebAccessKeyValue ||
                             process.env.SOLAR_WEB_ACCESS_KEY_VALUE ||
                             '2f62d6f2-77e6-4796-9fd1-5d74b5c6474c';
        const apiBaseUrl = API_BASE_URL;

        const requestHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json', // Good practice to add Accept header
            'AccessKeyId': accessKeyId,
            'AccessKeyValue': accessKeyValue,
            'Authorization': `Bearer ${jwtToken}`,
        };

        const options: RequestInit = {
            method,
            headers: requestHeaders,
            body: body ? JSON.stringify(body) : null
        };

        const queryString = buildQueryString(queryParams);
        // Fix for double slash issue: normalize URL path by removing trailing slashes from base URL
        // and leading slashes from endpoint
        const normalizedBaseUrl = apiBaseUrl.replace(/\/+$/, '');
        const normalizedEndpoint = endpoint.replace(/^\/+/, '');
        const url = `${normalizedBaseUrl}/${normalizedEndpoint}${queryString}`;
        console.log('API request URL:', url);

        const response = await fetch(url, options);

        // Handle different response statuses
        if (!response.ok) {
            let errorText = '';
            let errorObject = null;
            
            // Try to get detailed error information
            try {
                const contentType = response.headers.get('Content-Type') || '';
                if (contentType.includes('application/json')) {
                    errorObject = await response.json();
                    errorText = JSON.stringify(errorObject);
                } else {
                    errorText = await response.text();
                }
            } catch (parseError) {
                console.warn("Failed to parse error response as JSON, reading as text.", parseError);
                try {
                    errorText = await response.text();
                } catch (textError) {
                    console.warn("Failed to get error text response", textError);
                    errorText = "Body: ";
                }
            }
            
            const errorMessage = `HTTP error! Status: ${response.status} - ${errorText}`;
            console.error(`API Error Details for ${url}:`, errorMessage);
            throw new Error(errorMessage);
        }

        // Return data if we have a valid response
        const responseData = await response.json();
        return responseData;
    } catch (error) {
        console.error(`API request failed for endpoint "${endpoint}":`, error);
        throw error;
    }
}

// --- Local Backend API request function (for your backend database) ---
async function localApiRequest<T>(
    endpoint: string,
    method: string = 'GET',
    queryParams: Record<string, any> = {},
    body: any = null
): Promise<T> {
    try {
        const requestHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };

        const options: RequestInit = {
            method,
            headers: requestHeaders,
            body: body ? JSON.stringify(body) : null
        };

        const queryString = buildQueryString(queryParams);
        // Use API_URL for local backend calls
        const normalizedBaseUrl = API_URL.replace(/\/+$/, '');
        const normalizedEndpoint = endpoint.replace(/^\/+/, '');
        const url = `${normalizedBaseUrl}/${normalizedEndpoint}${queryString}`;
        console.log('Local API request URL:', url);

        const response = await fetch(url, options);

        // Handle different response statuses
        if (!response.ok) {
            let errorText = '';
            let errorObject = null;
            
            // Try to get detailed error information
            try {
                const contentType = response.headers.get('Content-Type') || '';
                if (contentType.includes('application/json')) {
                    errorObject = await response.json();
                    errorText = JSON.stringify(errorObject);
                } else {
                    errorText = await response.text();
                }
            } catch (parseError) {
                console.warn("Failed to parse error response as JSON, reading as text.", parseError);
                try {
                    errorText = await response.text();
                } catch (textError) {
                    console.warn("Failed to get error text response", textError);
                    errorText = "Body: ";
                }
            }
            
            const errorMessage = `HTTP error! Status: ${response.status} - ${errorText}`;
            console.error(`Local API Error Details for ${url}:`, errorMessage);
            throw new Error(errorMessage);
        }

        // Return data if we have a valid response
        const responseData = await response.json();
        return responseData;
    } catch (error) {
        console.error(`Local API request failed for endpoint "${endpoint}":`, error);
        throw error;
    }
}


// === API Function Definitions with Types ===

// --- PV SYSTEM API Calls ---

export const getPvSystems = async (
    offset?: number, limit?: number, type?: string | string[]
): Promise<PvSystemMetadata[]> => {
    try {
        // Use the generic apiRequest and expect PvSystemsListResponse structure
        const data = await apiRequest<PvSystemsListResponse>(
            'pvsystems', 'GET', { offset: offset || 0, limit: limit || 1000, type }
        );
        // Handle cases where the API might return null/undefined instead of an empty list
        return data?.pvSystems || [];
    } catch (error) {
        console.error("Failed to get PV systems list", error);
        throw error;
    }
};

export const getPvSystemDetails = async (
    pvSystemId: string
): Promise<PvSystemMetadata> => {
    if (!pvSystemId) throw new Error("pvSystemId is required for getPvSystemDetails");
    try {
        // Expecting a single PvSystemMetadata object
        return await apiRequest<PvSystemMetadata>(`pvsystems/${pvSystemId}`, 'GET');
    } catch (error) {
        console.error(`Failed to get PV system details for ${pvSystemId}`, error);
        throw error;
    }
};

export const getPvSystemAggregatedData = async (
    pvSystemId: string, params: AggregatedDataParams = {}
): Promise<AggregatedDataResponse> => {
     if (!pvSystemId) throw new Error("pvSystemId is required for getPvSystemAggregatedData");
    try {
        return await apiRequest<AggregatedDataResponse>(`pvsystems/${pvSystemId}/aggrdata`, 'GET', params);
    } catch (error) {
        console.error(`Failed to get aggregated data for PV system ${pvSystemId}`, error);
        throw error;
    }
};

export const getPvSystemHistoricalData = async (
    pvSystemId: string, params: HistoricalDataParams
): Promise<HistoricalDataResponse> => {
    if (!pvSystemId) throw new Error("pvSystemId is required for getPvSystemHistoricalData");
    if (!params.from || !params.to) throw new Error("'from' and 'to' are required for historical data");
    try {
        return await apiRequest<HistoricalDataResponse>(`pvsystems/${pvSystemId}/histdata`, 'GET', params);
    } catch (error) {
        console.error(`Failed to get historical data for PV system ${pvSystemId}`, error);
        throw error;
    }
};

// CONSOLIDATED DynamoDB API functions - replaces all separate functions
export const getConsolidatedDailyData = async (
    pvSystemId: string,
    date?: string
): Promise<any> => {
    if (!pvSystemId) throw new Error("pvSystemId is required for getConsolidatedDailyData");
    try {
        const params: any = {};
        if (date) params.date = date;
        
        return await localApiRequest<any>(`api/systems/${pvSystemId}/consolidated-daily`, 'GET', params);
    } catch (error) {
        console.error(`Failed to get consolidated daily data for PV system ${pvSystemId}`, error);
        throw error;
    }
};

export const getConsolidatedWeeklyData = async (
    pvSystemId: string,
    weekStart?: string
): Promise<any> => {
    if (!pvSystemId) throw new Error("pvSystemId is required for getConsolidatedWeeklyData");
    try {
        const params: any = {};
        if (weekStart) params.week_start = weekStart;
        
        return await localApiRequest<any>(`api/systems/${pvSystemId}/consolidated-weekly`, 'GET', params);
    } catch (error) {
        console.error(`Failed to get consolidated weekly data for PV system ${pvSystemId}`, error);
        throw error;
    }
};

export const getConsolidatedMonthlyData = async (
    pvSystemId: string,
    month?: string
): Promise<any> => {
    if (!pvSystemId) throw new Error("pvSystemId is required for getConsolidatedMonthlyData");
    try {
        const params: any = {};
        if (month) params.month = month;
        
        return await localApiRequest<any>(`api/systems/${pvSystemId}/consolidated-monthly`, 'GET', params);
    } catch (error) {
        console.error(`Failed to get consolidated monthly data for PV system ${pvSystemId}`, error);
        throw error;
    }
};

export const getConsolidatedYearlyData = async (
    pvSystemId: string,
    year?: string
): Promise<any> => {
    if (!pvSystemId) throw new Error("pvSystemId is required for getConsolidatedYearlyData");
    try {
        const params: any = {};
        if (year) params.year = year;
        
        return await localApiRequest<any>(`api/systems/${pvSystemId}/consolidated-yearly`, 'GET', params);
    } catch (error) {
        console.error(`Failed to get consolidated yearly data for PV system ${pvSystemId}`, error);
        throw error;
    }
};

export const getPvSystemMessages = async (
    pvSystemId: string, params: SystemMessagesParams = {}, language?: string
): Promise<SystemMessage[]> => {
     if (!pvSystemId) throw new Error("pvSystemId is required for getPvSystemMessages");
    const endpoint = language ? `pvsystems/${pvSystemId}/messages/${language}` : `pvsystems/${pvSystemId}/messages`;
    try {
        // Expecting an array of SystemMessage or null for 204
        const data = await apiRequest<SystemMessage[] | null>(endpoint, 'GET', params);
        return data || []; // Return empty array if response is null/204
    } catch (error) {
        console.error(`Failed to get messages for PV system ${pvSystemId}`, error);
        throw error;
    }
};
// TODO: COMPLETE WEATHER CHANNELS
export const getCurrentWeather = async (
    pvSystemId: string, params: WeatherParams = {}
): Promise<CurrentWeatherResponse | null> => {
    if (!pvSystemId) throw new Error("pvSystemId is required for getCurrentWeather");
    try {
        return await apiRequest<CurrentWeatherResponse>(
            ENDPOINTS.SOLARWEB.PV_SYSTEM_WEATHER(pvSystemId),
            'GET',
            params
        );
    } catch (error) {
        // Log the error but return null instead of throwing
        // This allows the app to continue functioning even if weather data isn't available
        console.error(`Failed to get current weather for PV system ${pvSystemId}`, error);
        return null;
    }
};


export const getPvSystemDevices = async (
    pvSystemId: string, offset?: number, limit?: number, type?: string | string[], isActive?: boolean
): Promise<DeviceMetadata[]> => {
     if (!pvSystemId) throw new Error("pvSystemId is required for getPvSystemDevices");
    try {
        const data = await apiRequest<DevicesListResponse>(
            `pvsystems/${pvSystemId}/devices`, 'GET', { offset, limit, type, isActive }
        );
        return data?.devices || []; // Ensure array return
    } catch (error) {
        console.error(`Failed to get devices for PV system ${pvSystemId}`, error);
        throw error;
    }
};

export const getPvSystemFlowData = async (
    pvSystemId: string, timezone?: 'local' | 'zulu'
): Promise<FlowDataResponse> => {
     if (!pvSystemId) throw new Error("pvSystemId is required for getPvSystemFlowData");
    try {
        return await apiRequest<FlowDataResponse>(`pvsystems/${pvSystemId}/flowdata`, 'GET', { timezone });
    } catch (error) {
        console.error(`Failed to get flow data for PV system ${pvSystemId}`, error);
        throw error;
    }
};
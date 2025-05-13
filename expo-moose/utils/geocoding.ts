import Geocoding from 'react-native-geocoding';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Cache for storing geocoded coordinates
const geocodingCache = new Map<string, {latitude: number, longitude: number}>();
const CACHE_KEY_PREFIX = 'geocoding_cache_';

// Initialize the geocoding module with your API key
export const initGeocoding = (apiKey: string) => {
  if (!apiKey || apiKey.trim() === '' || apiKey === 'YOUR_API_KEY') {
    console.error('Invalid Google Maps API key provided');
    return;
  }
  
  try {
    Geocoding.init(apiKey, { language: 'en' });
    console.log('Geocoding initialized successfully');
    
    // Pre-load cache from AsyncStorage
    loadGeocodeCache().catch(err => {
      console.warn('Failed to load geocoding cache:', err);
    });
  } catch (error) {
    console.error('Failed to initialize Geocoding:', error);
  }
};

// Load cached geocoding results from AsyncStorage
const loadGeocodeCache = async () => {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter(key => key.startsWith(CACHE_KEY_PREFIX));
    
    if (cacheKeys.length > 0) {
      const cacheItems = await AsyncStorage.multiGet(cacheKeys);
      cacheItems.forEach(([key, value]) => {
        if (value) {
          try {
            const address = key.replace(CACHE_KEY_PREFIX, '');
            const coords = JSON.parse(value);
            if (coords && typeof coords.latitude === 'number' && typeof coords.longitude === 'number') {
              geocodingCache.set(address, coords);
            }
          } catch (parseError) {
            console.warn('Error parsing cached geocoding data:', parseError);
          }
        }
      });
      console.log(`Loaded ${geocodingCache.size} cached geocoding results`);
    }
  } catch (error) {
    console.error('Error loading geocoding cache:', error);
  }
};

// Store geocoded result in cache
const cacheGeocodingResult = async (address: string, coords: {latitude: number, longitude: number}) => {
  if (!address || !coords || typeof coords.latitude !== 'number' || typeof coords.longitude !== 'number') {
    console.warn('Invalid geocoding data for caching');
    return;
  }
  
  try {
    geocodingCache.set(address, coords);
    await AsyncStorage.setItem(CACHE_KEY_PREFIX + address, JSON.stringify(coords));
  } catch (error) {
    console.warn('Failed to cache geocoding result:', error);
  }
};

// Get coordinates from existing system data if available
export const getCoordinatesFromSystem = (system: any): {latitude: number, longitude: number} | null => {
  try {
    // Check if the system already has location data in gpsData
    if (system && system.gpsData) {
      if (typeof system.gpsData.latitude === 'number' && typeof system.gpsData.longitude === 'number') {
        console.log(`Found gpsData coordinates in system: ${system.name || system.pvSystemId}`);
        return {
          latitude: system.gpsData.latitude,
          longitude: system.gpsData.longitude
        };
      }
    }
    
    // Try other possible property formats
    if (system && system.location && typeof system.location.latitude === 'number' && typeof system.location.longitude === 'number') {
      return {
        latitude: system.location.latitude,
        longitude: system.location.longitude
      };
    }
    
    if (system && system.coords && typeof system.coords.latitude === 'number' && typeof system.coords.longitude === 'number') {
      return system.coords;
    }
    
    if (system && typeof system.latitude === 'number' && typeof system.longitude === 'number') {
      return {
        latitude: system.latitude,
        longitude: system.longitude
      };
    }
  } catch (error) {
    console.error('Error extracting coordinates from system:', error);
  }
  
  return null;
};

// Convert an address to geographic coordinates with retry logic and cache
export const geocodeAddress = async (address: string, retryCount = 2): Promise<{latitude: number, longitude: number}> => {
  if (!address || address.trim() === '') {
    throw new Error('Empty address provided to geocodeAddress');
  }
  
  // First check cache
  if (geocodingCache.has(address)) {
    console.log(`Using cached geocoding result for: ${address}`);
    return geocodingCache.get(address)!;
  }
  
  let attempts = 0;
  
  const attemptGeocoding = async (): Promise<{ latitude: number; longitude: number }> => {
    try {
      attempts++;
      console.log(`Geocoding attempt ${attempts} for address: ${address}`);
      
      const response = await Promise.race([
        Geocoding.from(address),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Geocoding request timeout')), 5000)
        )
      ]) as any;
      
      // Check if we have results
      if (!response || !response.results || response.results.length === 0) {
        console.warn('No geocoding results found for address:', address);
        throw new Error('No geocoding results found for this address');
      }
      
      const { lat, lng } = response.results[0].geometry.location;
      
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        throw new Error('Invalid coordinates in geocoding results');
      }
      
      const coords = { latitude: lat, longitude: lng };
      
      // Cache the result
      await cacheGeocodingResult(address, coords);
      
      return coords;
    } catch (error) {
      // Log detailed error information
      if (error instanceof Error) {
        console.error(`Error geocoding address "${address}":`, error.message);
      } else {
        console.error('Unknown error geocoding address:', error);
      }
      
      // Retry logic
      if (attempts < retryCount) {
        console.log(`Retrying geocoding (${attempts}/${retryCount})...`);
        return new Promise(resolve => {
          // Wait a bit before retrying
          setTimeout(async () => {
            resolve(await attemptGeocoding());
          }, 1000);
        });
      }
      
      // No more retries, throw error
      throw new Error(`Failed to geocode address after ${attempts} attempts`);
    }
  };
  
  return attemptGeocoding();
};

// Format an address object to a string
export const formatAddress = (address: {
  street: string;
  city: string;
  zipCode: string;
  country: string;
  state: string | null;
}): string => {
  const parts = [];
  
  if (address.street) parts.push(address.street);
  if (address.city) parts.push(address.city);
  
  if (address.state) {
    if (address.zipCode) {
      parts.push(`${address.state} ${address.zipCode}`);
    } else {
      parts.push(address.state);
    }
  } else if (address.zipCode) {
    parts.push(address.zipCode);
  }
  
  if (address.country) parts.push(address.country);
  
  return parts.join(', ');
}; 
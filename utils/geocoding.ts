import Geocoding from 'react-native-geocoding';
import Constants from 'expo-constants';

// Initialize the geocoding module with your API key
export const initGeocoding = (apiKey: string) => {
  Geocoding.init(apiKey);
};

// Convert an address to geographic coordinates
export const geocodeAddress = async (address: string) => {
  try {
    const response = await Geocoding.from(address);
    
    // Check if we have results
    if (!response.results || response.results.length === 0) {
      console.warn('No geocoding results found for address:', address);
      throw new Error('No geocoding results found for this address');
    }
    
    const { lat, lng } = response.results[0].geometry.location;
    return { latitude: lat, longitude: lng };
  } catch (error) {
    // Log detailed error information
    if (error instanceof Error) {
      console.error(`Error geocoding address "${address}":`, error.message);
    } else {
      console.error('Unknown error geocoding address:', error);
    }
    
    // Try to extract useful information from the address for a better fallback
    try {
      // Use a default location based on the country if possible
      if (address.includes('Canada')) {
        return { latitude: 45.4215, longitude: -75.6972 }; // Ottawa, Canada
      } else if (address.includes('USA') || address.includes('United States')) {
        return { latitude: 38.8977, longitude: -77.0365 }; // Washington DC, USA
      } else if (address.includes('UK') || address.includes('United Kingdom')) {
        return { latitude: 51.5074, longitude: -0.1278 }; // London, UK
      }
    } catch (fallbackError) {
      console.error('Error in geocoding fallback:', fallbackError);
    }
    
    // Return a default location if all else fails
    return { latitude: 0, longitude: 0 };
  }
};

// Format an address from the PV system data
export const formatAddress = (address: {
  street: string;
  city: string;
  zipCode: string;
  country: string;
  state: string | null;
}) => {
  const { street, city, zipCode, country, state } = address;
  
  // Handle case where some address components might be missing
  const streetStr = street ? `${street}, ` : '';
  const cityStr = city ? `${city}` : '';
  const stateStr = state ? `, ${state}` : '';
  const zipStr = zipCode ? `, ${zipCode}` : '';
  const countryStr = country ? `, ${country}` : '';
  
  return `${streetStr}${cityStr}${stateStr}${zipStr}${countryStr}`;
}; 
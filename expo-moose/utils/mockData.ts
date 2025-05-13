import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { PvSystem } from '@/components/PvSystemList';

// Check if running in simulator
export const isSimulator = (): boolean => {
  if (Platform.OS === 'ios') {
    try {
      const deviceName = Constants.deviceName || '';
      if (deviceName.includes('Simulator')) {
        return true;
      }
      return (__DEV__ && !Constants.isDevice);
    } catch (e) {
      return __DEV__ && typeof navigator !== 'undefined' && /simulator/i.test(navigator.userAgent || '');
    }
  } else if (Platform.OS === 'android') {
    try {
      return __DEV__ && (Constants.debugMode || false);
    } catch (e) {
      return __DEV__;
    }
  }
  return false;
};

// Pre-defined PV system locations
const MOCK_LOCATIONS = [
  { name: 'Ottawa Solar Farm', latitude: 45.4215, longitude: -75.6972 },
  { name: 'Toronto Energy Center', latitude: 43.6532, longitude: -79.3832 },
  { name: 'Vancouver Green Power', latitude: 49.2827, longitude: -123.1207 },
  { name: 'Montreal Sun Panels', latitude: 45.5017, longitude: -73.5673 },
  { name: 'Calgary Wind & Solar', latitude: 51.0447, longitude: -114.0719 },
  { name: 'Halifax Ocean Energy', latitude: 44.6488, longitude: -63.5752 },
  { name: 'Winnipeg Prairie Solar', latitude: 49.8951, longitude: -97.1384 },
  { name: 'Quebec City Hydro Solar', latitude: 46.8139, longitude: -71.2082 },
];

// Generate a mock PV system with reliable coordinates 
export const getMockPvSystem = (index: number): Partial<PvSystem> => {
  try {
    // Ensure index is within bounds
    const safeIndex = Math.max(0, index) % MOCK_LOCATIONS.length;
    const mockLocation = MOCK_LOCATIONS[safeIndex];
    const id = `MOCK-${(index + 1).toString().padStart(3, '0')}`;
    
    // Add some minor variation to prevent exact overlapping
    const latVariation = (Math.random() - 0.5) * 0.01;
    const lngVariation = (Math.random() - 0.5) * 0.01;
    
    // Get a random month and day that are valid
    const randomMonth = index % 12;
    const randomDay = (index % 28) + 1;
    
    // Create current date for lastImport
    const now = new Date();
    
    return {
      pvSystemId: id,
      name: `${mockLocation.name} ${index + 1}`,
      peakPower: 5000 + Math.floor(Math.random() * 5000),
      address: {
        street: `${100 + index} Solar Street`,
        city: mockLocation.name.split(' ')[0],
        zipCode: `A1B ${index}C${index}`,
        country: 'Canada',
        state: 'ON',
      },
      installationDate: new Date(2020, randomMonth, randomDay).toISOString(),
      lastImport: now.toISOString(),
      // Add coordinates directly to make them available
      gpsData: {
        latitude: mockLocation.latitude + latVariation,
        longitude: mockLocation.longitude + lngVariation,
      }
    };
  } catch (error) {
    console.error('Error generating mock PV system:', error);
    
    // Return a default mock system as fallback
    return {
      pvSystemId: `MOCK-ERROR-${index}`,
      name: `Fallback Solar System ${index}`,
      peakPower: 5000,
      address: {
        street: '123 Default Street',
        city: 'Ottawa',
        zipCode: 'A1B 2C3',
        country: 'Canada',
        state: 'ON',
      },
      installationDate: new Date().toISOString(),
      lastImport: new Date().toISOString(),
      gpsData: {
        latitude: 45.4215,
        longitude: -75.6972,
      }
    };
  }
};

// Generate a list of mock PV systems
export const generateMockPvSystems = (count: number = 8): Partial<PvSystem>[] => {
  try {
    // Ensure count is a positive number
    const safeCount = Math.max(1, Math.min(50, count || 8));
    return Array.from({ length: safeCount }, (_, i) => getMockPvSystem(i));
  } catch (error) {
    console.error('Error generating mock PV systems:', error);
    // Return at least one mock system as fallback
    return [getMockPvSystem(0)];
  }
}; 
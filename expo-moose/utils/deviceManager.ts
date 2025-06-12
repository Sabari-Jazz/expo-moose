import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { v4 as uuidv4 } from 'uuid';
import { API_URL } from '@/constants/api';

// Storage keys
const DEVICE_ID_KEY = 'device_id';
const PUSH_TOKEN_KEY = 'expo_push_token';

// Device registration interface
interface DeviceRegistrationData {
  user_id: string;
  device_id: string;
  expo_push_token: string;
  platform: string;
}

/**
 * Get or generate a persistent device ID
 */
export async function getOrCreateDeviceId(): Promise<string> {
  try {
    // Try to get existing device ID
    let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
    
    if (!deviceId) {
      // Generate new UUID-based device ID
      deviceId = uuidv4();
      await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
      console.log(`Generated new device ID: ${deviceId}`);
    } else {
      console.log(`Using existing device ID: ${deviceId}`);
    }
    
    return deviceId;
  } catch (error) {
    console.error('Error getting/creating device ID:', error);
    // Fallback to timestamp-based ID if UUID fails
    const fallbackId = `device_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    console.log(`Using fallback device ID: ${fallbackId}`);
    return fallbackId;
  }
}

/**
 * Register for push notifications and get Expo push token
 */
export async function getExpoPushToken(): Promise<string | null> {
  try {
    // Check if device is physical device
    if (!Device.isDevice) {
      console.log('Must use physical device for Push Notifications');
      return null;
    }

    // Check existing permissions
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    // Request permissions if not granted
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Failed to get push token for push notification!');
      return null;
    }

    // Get the push token
    const token = (await Notifications.getExpoPushTokenAsync({
      projectId: 'a6e0a3fc-5475-4e55-819f-8257b0ea3fb3', // Your existing project ID
    })).data;

    console.log('Expo push token obtained:', token);
    
    // Store token locally for reference
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    
    return token;
  } catch (error) {
    console.error('Error getting push token:', error);
    return null;
  }
}

/**
 * Register device with backend API
 */
export async function registerDeviceWithBackend(userId: string): Promise<boolean> {
  try {
    console.log(`Starting device registration for user: ${userId}`);
    
    // Get or create device ID
    const deviceId = await getOrCreateDeviceId();
    
    // Get push token
    const pushToken = await getExpoPushToken();
    
    if (!pushToken) {
      console.log('No push token available, skipping device registration');
      return false;
    }

    // Prepare registration data
    const registrationData: DeviceRegistrationData = {
      user_id: userId,
      device_id: deviceId,
      expo_push_token: pushToken,
      platform: Platform.OS === 'ios' ? 'iOS' : 'android',
    };

    console.log(`Registering device with backend:`, {
      user_id: registrationData.user_id,
      device_id: registrationData.device_id,
      platform: registrationData.platform,
      token_preview: `${pushToken.substring(0, 20)}...`
    });

    // Send registration to backend
    const response = await fetch(`${API_URL}/api/device/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(registrationData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Device registration failed: ${response.status} - ${errorText}`);
      return false;
    }

    const result = await response.json();
    console.log('Device registration successful:', result.message);
    
    return true;
  } catch (error) {
    console.error('Error registering device with backend:', error);
    return false;
  }
}

/**
 * Get stored device ID (without creating new one)
 */
export async function getStoredDeviceId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(DEVICE_ID_KEY);
  } catch (error) {
    console.error('Error getting stored device ID:', error);
    return null;
  }
}

/**
 * Get stored push token
 */
export async function getStoredPushToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  } catch (error) {
    console.error('Error getting stored push token:', error);
    return null;
  }
}

/**
 * Get device registration status for debugging
 */
export async function getDeviceRegistrationStatus(): Promise<{
  deviceId: string | null;
  pushToken: string | null;
  platform: string;
}> {
  return {
    deviceId: await getStoredDeviceId(),
    pushToken: await getStoredPushToken(),
    platform: Platform.OS === 'ios' ? 'iOS' : 'android',
  };
}

/**
 * Delete device registration from backend when user logs out
 */
export async function deleteDeviceFromBackend(userId: string): Promise<boolean> {
  try {
    console.log(`Starting device deletion for user: ${userId}`);
    
    // Get stored device ID
    const deviceId = await getStoredDeviceId();
    
    if (!deviceId) {
      console.log('No device ID found, nothing to delete');
      return true; // Consider this successful since there's nothing to delete
    }

    console.log(`Deleting device registration: User ${userId}, Device ${deviceId}`);

    // Send deletion request to backend
    const response = await fetch(`${API_URL}/api/device/${userId}/${deviceId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Device deletion failed: ${response.status} - ${errorText}`);
      return false;
    }

    const result = await response.json();
    console.log('Device deletion successful:', result.message);
    
    // Optionally clear local storage after successful deletion
    await AsyncStorage.removeItem(DEVICE_ID_KEY);
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
    console.log('Local device data cleared');
    
    return true;
  } catch (error) {
    console.error('Error deleting device from backend:', error);
    return false;
  }
} 
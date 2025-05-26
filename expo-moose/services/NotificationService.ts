import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as api from '../api/api';

// Key for storing the user's preferred/primary PV system ID
const PRIMARY_PV_SYSTEM_ID_KEY = 'primary_pv_system_id';

// Configure how notifications appear when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Request notification permissions
export async function registerForPushNotificationsAsync() {
  let token;
  
  if (Platform.OS === 'android') {
    // Set up notification channels for Android
    await Notifications.setNotificationChannelAsync('daily-reminders', {
      name: 'Daily Reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#0066CC',
    });
  }
  
  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    
    if (finalStatus !== 'granted') {
      console.log('Failed to get push token for push notification!');
      return;
    }
    
    // Project ID may need to be updated based on your expo project
    token = (await Notifications.getExpoPushTokenAsync({
      projectId: 'a6e0a3fc-5475-4e55-819f-8257b0ea3fb3',
    })).data;
  } else {
    console.log('Must use physical device for Push Notifications');
  }

  return token;
}

// Set primary PV system ID for notifications
export async function setPrimaryPvSystemId(pvSystemId: string) {
  await AsyncStorage.setItem(PRIMARY_PV_SYSTEM_ID_KEY, pvSystemId);
}

// Get primary PV system ID for notifications
export async function getPrimaryPvSystemId(): Promise<string | null> {
  return await AsyncStorage.getItem(PRIMARY_PV_SYSTEM_ID_KEY);
}

// Helper function to find a specific channel value in channel array
export function findChannelValue(
  channels?: api.ApiChannel[] | null,
  channelName?: string
): number | null {
  if (!channels || !channelName) return null;
  
  const channel = channels.find((ch) => ch.channelName === channelName);
  return typeof channel?.value === 'number' ? channel.value : null;
}

// Fetch today's energy production data for a PV system
export async function fetchTodaysEnergyProduction(pvSystemId: string): Promise<string | null> {
  try {
    if (!pvSystemId) {
      console.log('No PV system ID provided for energy production');
      return null;
    }
    
    // Get today's date in YYYY-MM-DD format
    const today = new Date();
    const formattedDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    
    const aggrData = await api.getPvSystemAggregatedData(pvSystemId, {
      from: formattedDate,
      duration: 1,
      channel: 'EnergyProductionTotal',
    });
    
    if (aggrData?.data?.length > 0) {
      const energyProduced = findChannelValue(
        aggrData.data[0].channels,
        'EnergyProductionTotal'
      );
      
      if (energyProduced !== null) {
        // Convert to kWh with 2 decimal places
        return (energyProduced / 1000).toFixed(2);
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching energy production data:', error);
    return null;
  }
}

// Schedule the morning notification (9 AM)
export async function scheduleMorningNotification() {
  // Cancel any existing morning notifications first
  await cancelScheduledNotification('morning-notification');
  
  // Get the primary PV system ID
  const pvSystemId = await getPrimaryPvSystemId();
  
  const now = new Date();
  const scheduledTime = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    9, // 9 AM
    0, // 0 minutes
    0 // 0 seconds
  );
  
  // If it's already past 9 AM, schedule for tomorrow
  if (now.getHours() >= 9) {
    scheduledTime.setDate(scheduledTime.getDate() + 1);
  }

  return await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Good Morning!',
      body: 'Time to check your solar system\'s performance for the day.',
      data: { 
        type: 'morning-notification',
        pvSystemId: pvSystemId || undefined 
      },
    },
    trigger: {
      date: scheduledTime,
      repeats: true,
      channelId: 'daily-reminders',
    },
    identifier: 'morning-notification',
  });
}

// Schedule the evening notification (6 PM)
export async function scheduleEveningNotification(energyProduced?: string | null) {
  // Cancel any existing evening notifications first
  await cancelScheduledNotification('evening-notification');
  
  // Get the primary PV system ID
  const pvSystemId = await getPrimaryPvSystemId();
  
  const now = new Date();
  const scheduledTime = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    18, // 6 PM
    0, // 0 minutes
    0 // 0 seconds
  );
  
  // If it's already past 6 PM, schedule for tomorrow
  if (now.getHours() >= 18) {
    scheduledTime.setDate(scheduledTime.getDate() + 1);
  }

  // If no energy provided, attempt to fetch it from the system
  if (!energyProduced && pvSystemId) {
    try {
      energyProduced = await fetchTodaysEnergyProduction(pvSystemId);
    } catch (error) {
      console.error('Error fetching energy data for notification:', error);
    }
  }

  let systemName = 'your solar system';

  // Try to get the system name for a more personalized notification
  if (pvSystemId) {
    try {
      const systemDetails = await api.getPvSystemDetails(pvSystemId);
      if (systemDetails && systemDetails.name) {
        systemName = systemDetails.name;
      }
    } catch (error) {
      console.error('Error fetching system name:', error);
    }
  }

  const energyMessage = energyProduced 
    ? `${systemName} produced ${energyProduced} kWh today!` 
    : `Check ${systemName}'s daily production summary.`;

  return await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Daily Solar Summary',
      body: energyMessage,
      data: { 
        type: 'evening-notification',
        pvSystemId: pvSystemId || undefined 
      },
    },
    trigger: {
      date: scheduledTime,
      repeats: true,
      channelId: 'daily-reminders',
    },
    identifier: 'evening-notification',
  });
}

// Schedule both daily notifications
export async function scheduleAllDailyNotifications() {
  await scheduleMorningNotification();
  await scheduleEveningNotification();
  return true;
}

// For testing purposes: send a notification immediately
export async function sendDemoNotification(type: 'morning' | 'evening') {
  let title, body;
  const pvSystemId = await getPrimaryPvSystemId();
  let systemName = 'your solar system';
  
  // Try to get the system name if we have an ID
  if (pvSystemId) {
    try {
      const systemDetails = await api.getPvSystemDetails(pvSystemId);
      if (systemDetails && systemDetails.name) {
        systemName = systemDetails.name;
      }
    } catch (error) {
      console.error('Error fetching system name for demo:', error);
    }
  }
  
  if (type === 'morning') {
    title = 'Demo: Morning Notification';
    body = `Good morning! Time to check ${systemName}'s performance.`;
  } else {
    // For evening demo, try to get real production data
    let energyMessage = `Demo: ${systemName} produced 15.7 kWh today. Great job!`;
    
    if (pvSystemId) {
      try {
        const energyProduced = await fetchTodaysEnergyProduction(pvSystemId);
        if (energyProduced) {
          energyMessage = `Demo: ${systemName} produced ${energyProduced} kWh today!`;
        }
      } catch (error) {
        console.error('Error in demo notification:', error);
      }
    }
    
    title = 'Demo: Evening Summary';
    body = energyMessage;
  }

  return await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: { 
        type: `demo-${type}-notification`,
        pvSystemId: pvSystemId || undefined 
      },
    },
    trigger: null, // null means send immediately
  });
}

// Cancel a scheduled notification by identifier
export async function cancelScheduledNotification(identifier: string) {
  await Notifications.cancelScheduledNotificationAsync(identifier);
}

// Cancel all scheduled notifications
export async function cancelAllNotifications() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

// Get all scheduled notifications
export async function getAllScheduledNotifications() {
  return await Notifications.getAllScheduledNotificationsAsync();
}

// Status notifications
export async function sendStatusNotification(status: 'online' | 'warning' | 'error' | 'offline') {
  // Check if notifications are enabled
  try {
    console.log('Sending status notification');
    const notificationsEnabled = await AsyncStorage.getItem('notifications_enabled_key');
    if (notificationsEnabled !== 'true') {
      console.log('Status notifications are disabled, not sending notification');
      return;
    }
  } catch (error) {
    console.error('Error checking notification settings:', error);
  }

  let title, body, priority;
  
  switch (status) {
    case 'offline':
      title = 'System Offline';
      body = 'One or more of your solar systems is currently offline. Please check the app for details.';
      priority = Notifications.AndroidImportance.HIGH;
      break;
    case 'error':
      title = 'System Error';
      body = 'One or more of your solar systems is reporting an error. Please check the app for details.';
      priority = Notifications.AndroidImportance.HIGH;
      break;
    case 'warning':
      title = 'System Warning';
      body = 'One or more of your solar systems is showing a warning. Please check the app for details.';
      priority = Notifications.AndroidImportance.DEFAULT;
      break;
    case 'online':
      title = 'Systems Online';
      body = 'All your solar systems are now operating normally.';
      priority = Notifications.AndroidImportance.LOW;
      break;
  }

  // Store the last status to avoid sending repeated notifications
  const lastStatus = await AsyncStorage.getItem('last_status_notification');
  
  // Only send a notification if status has changed
  if (lastStatus !== status) {
    await AsyncStorage.setItem('last_status_notification', status);
    
    // Create a status-specific channel for Android
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('system-status', {
        name: 'System Status Alerts',
        importance: priority,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: status === 'online' ? '#4CAF50' : status === 'warning' ? '#FF9800' : '#F44336',
      });
    }
    
    return await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: { 
          type: 'status-notification',
          status 
        },
      },
      trigger: null, // null means send immediately
      identifier: `status-notification-${Date.now()}`,
    });
  } else {
    console.log(`Status ${status} already notified, skipping notification`);
    return null;
  }
} 
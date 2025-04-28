// Simple local storage utility for feedback data
import AsyncStorage from '@react-native-async-storage/async-storage';

// Constants
const FEEDBACK_STORAGE_KEY = 'local_feedback_data';

// Helper function to load feedback data from AsyncStorage
export const loadFeedbackFromStorage = async () => {
  try {
    const storedData = await AsyncStorage.getItem(FEEDBACK_STORAGE_KEY);
    return storedData ? JSON.parse(storedData) : [];
  } catch (error) {
    console.error('Error loading feedback from storage:', error);
    return [];
  }
};

// Helper function to save feedback data to AsyncStorage
export const saveFeedbackToStorage = async (data: any[]) => {
  try {
    await AsyncStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('Error saving feedback to storage:', error);
    return false;
  }
}; 
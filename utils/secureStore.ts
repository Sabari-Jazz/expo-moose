import * as SecureStore from 'expo-secure-store';

/**
 * Save a value to secure storage
 * @param key The key to store the value under
 * @param value The value to store
 * @returns A promise that resolves when the value is saved
 */
export async function save(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch (error) {
    console.error('Error saving to secure store:', error);
  }
}

/**
 * Get a value from secure storage
 * @param key The key to retrieve
 * @returns The stored value or null if not found
 */
export async function getValueFor(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch (error) {
    console.error('Error reading from secure store:', error);
    return null;
  }
}

/**
 * Delete a value from secure storage
 * @param key The key to delete
 * @returns A promise that resolves when the value is deleted
 */
export async function deleteValueFor(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch (error) {
    console.error('Error deleting from secure store:', error);
  }
} 
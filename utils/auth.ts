import * as SecureStore from 'expo-secure-store';
import { save, getValueFor, deleteValueFor } from './secureStore';
import { router } from 'expo-router';

// Constants
export const AUTH_USER_KEY = 'auth_user';
export const AUTH_TOKEN_KEY = 'auth_token';

// Types
export interface User {
  id: string;
  username: string;
  password: string;
  name: string;
  role: 'admin' | 'user';
}

export interface SystemAccess {
  userId: string;
  systemIds: string[];
}

// Demo users
const users: User[] = [
  {
    id: '1',
    username: 'admin',
    password: 'admin123',
    name: 'Administrator',
    role: 'admin'
  },
  {
    id: '2',
    username: 'ketan',
    password: 'pass',
    name: 'Ketan',
    role: 'user'
  }
];

// System access table
const systemAccess: SystemAccess[] = [
  {
    userId: '2', // Ketan
    systemIds: [
      "bf915090-5f59-4128-a206-46c73f2f779d",
      "f2fafda2-9b07-40e3-875f-db6409040b9c"
    ]
  }
];

/**
 * Authenticate a user by username and password
 * @param username The username to authenticate
 * @param password The password to authenticate
 * @returns The authenticated user or null if authentication fails
 */
export async function authenticate(username: string, password: string): Promise<User | null> {
  // Find user with matching credentials
  const user = users.find(u => 
    u.username.toLowerCase() === username.toLowerCase() && 
    u.password === password
  );
  
  if (user) {
    // Store user info (without password) in secure store
    const userInfo = { ...user };
    delete userInfo.password;
    
    await save(AUTH_USER_KEY, JSON.stringify(userInfo));
    await save(AUTH_TOKEN_KEY, generateToken(user.id));
    
    return user;
  }
  
  return null;
}

/**
 * Check if a user has access to a specific system
 * @param userId The user ID to check
 * @param systemId The system ID to check access for
 * @returns Whether the user has access to the system
 */
export function hasSystemAccess(userId: string, systemId: string): boolean {
  // Admin has access to all systems
  const user = users.find(u => u.id === userId);
  if (user?.role === 'admin') {
    return true;
  }
  
  // Check user's system access
  const access = systemAccess.find(a => a.userId === userId);
  return access ? access.systemIds.includes(systemId) : false;
}

/**
 * Get systems accessible by a user
 * @param userId The user ID to check
 * @returns Array of system IDs the user has access to
 */
export function getAccessibleSystems(userId: string): string[] {
  // Admin has access to all systems (return empty array to indicate all)
  const user = users.find(u => u.id === userId);
  if (user?.role === 'admin') {
    return [];
  }
  
  // Get user's accessible systems
  const access = systemAccess.find(a => a.userId === userId);
  return access ? access.systemIds : [];
}

/**
 * Get the current authenticated user
 * @returns The current user or null if not authenticated
 */
export async function getCurrentUser(): Promise<Omit<User, 'password'> | null> {
  const userJson = await getValueFor(AUTH_USER_KEY);
  return userJson ? JSON.parse(userJson) : null;
}

/**
 * Log out the current user
 */
export const logout = async () => {
  try {
    // Remove auth token and user data from secure storage
    await deleteValueFor(AUTH_TOKEN_KEY);
    await deleteValueFor(AUTH_USER_KEY);
    
    // Redirect to login page
    router.replace("/");
    
    return true;
  } catch (error) {
    console.error("Error during logout:", error);
    return false;
  }
};

/**
 * Generate a simple token for auth (demo purposes only)
 */
function generateToken(userId: string): string {
  return `token_${userId}_${Date.now()}`;
} 
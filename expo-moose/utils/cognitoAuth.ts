import {
    fetchAuthSession,
    signIn as amplifySignIn,
    signOut as amplifySignOut,
    getCurrentUser as getAmpUser,
    confirmSignIn
  } from 'aws-amplify/auth';
  import { router } from 'expo-router';
  import { save, getValueFor, deleteValueFor } from './secureStore';
  import { API_URL } from '@/constants/api';
  import { registerDeviceWithBackend, deleteDeviceFromBackend } from './deviceManager';
  
  // Constants
  export const AUTH_USER_KEY = 'auth_user';
  export const ACCESS_TOKEN_KEY = 'auth_access_token';
  export const ID_TOKEN_KEY = 'auth_id_token';
  
  // Types
  export interface User {
    id: string;
    username: string;
    name: string;
    role: 'admin' | 'user';
    email: string;
    systems: string[];
  }
  
  /**
   * Sign in a user with Cognito
   */
  export async function signIn(username: string, password: string): Promise<User | null> {
    try {
      console.log('=== STARTING SIGN IN PROCESS ===');
      console.log('Username:', username);
      console.log('Environment check - Platform:', require('react-native').Platform.OS);
      
      // Check if Amplify is configured
      console.log('Checking Amplify configuration...');
      
      // Test network connectivity first
      console.log('Testing network connectivity...');
      /*
      try {
        const testResponse = await fetch('https://httpbin.org/get');
        console.log('Network test successful, status:', testResponse.status);
      } catch (networkError) {
        console.error('Network test failed:', networkError);
      }
        */

      console.log('Attempting amplifySignIn...');
      let response;
      
      try {
        response = await amplifySignIn({ 
          username, 
          password,
          options: {
            authFlowType: 'USER_SRP_AUTH' // Explicitly set auth flow
          }
        });
        console.log('amplifySignIn successful! Response received.');
        console.log('Response keys:', Object.keys(response));
        console.log('isSignedIn:', response.isSignedIn);
        console.log('nextStep:', response.nextStep);
      } catch (signInError: any) {
        console.error('=== AMPLIFY SIGN IN ERROR ===');
        console.error('Error object:', signInError);
        console.error('Error name:', signInError.name);
        console.error('Error message:', signInError.message);
        console.error('Error code:', signInError.code);
        
        // Handle specific case where user is already signed in
        if (signInError.name === 'UserAlreadyAuthenticatedException') {
          console.log('User already authenticated, getting current user...');
          try {
            return await handleSuccessfulSignIn(username);
          } catch (currentUserError) {
            console.error('Error getting current user:', currentUserError);
            // If getting current user fails, sign out and try again
            console.log('Signing out and retrying...');
            await amplifySignOut();
            // Retry the sign in
            response = await amplifySignIn({ 
              username, 
              password,
              options: {
                authFlowType: 'USER_SRP_AUTH'
              }
            });
          }
        } else {
          console.error('Error stack:', signInError.stack);
          
          // Try to extract more error details
          if (signInError.underlyingError) {
            console.error('Underlying error:', signInError.underlyingError);
          }
          if (signInError.$metadata) {
            console.error('AWS metadata:', signInError.$metadata);
          }
          
          throw signInError;
        }
      }

      if (response && response.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        console.log('User in FORCE_CHANGE_PASSWORD state. Completing new password challenge...');
        // Use the same password but mark it as permanent - for demo purposes
        // In production, you'd want to prompt the user for a new password
        const newPassword = password; // Keep the same password for simplicity
        
        try {
          response = await confirmSignIn({
            challengeResponse: newPassword,
            options: {
              userAttributes: {}
            }
          });
          console.log('confirmSignIn successful!');
          
          if (!response.isSignedIn) throw new Error('Failed to complete password change.');
        } catch (confirmError: any) {
          console.error('=== CONFIRM SIGN IN ERROR ===');
          console.error('Confirm error:', confirmError);
          throw confirmError;
        }
      }

      if (response && response.isSignedIn) {
        console.log('Sign in completed successfully, calling handleSuccessfulSignIn...');
        return await handleSuccessfulSignIn(username);
      }

      console.log('Sign in not completed, response:', response);
      return null;
    } catch (error: any) {
      console.error('=== FINAL SIGN IN ERROR ===');
      console.error('Final error object:', error);
      console.error('Error prototype:', Object.getPrototypeOf(error));
      console.error('Error constructor:', error.constructor.name);
      
      // Log all enumerable properties
      for (const key in error) {
        console.error(`Error.${key}:`, error[key]);
      }
      
      throw error;
    }
  }
  
  /**
   * Fetch user profile from DynamoDB backend
   */
  async function fetchUserProfile(userId: string): Promise<{
    email: string;
    name: string;
    role: 'admin' | 'user';
    username: string;
  } | null> {
    try {
      const response = await fetch(`${API_URL}/api/user/${userId}/profile`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error(`Failed to fetch user profile: ${response.status}`);
        return null;
      }

      const data = await response.json();
      console.log('User profile data:', data);
      return data;
    } catch (error) {
      console.error('Error fetching user profile:', error);
      return null;
    }
  }

  /**
   * Fetch user systems from DynamoDB backend
   */
  async function fetchUserSystems(userId: string): Promise<string[]> {
    try {
      const response = await fetch(`${API_URL}/api/user/${userId}/systems`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        console.error(`Failed to fetch user systems: ${response.status}`);
        return [];
      }
      
      const data = await response.json();
      console.log('User systems data:', data);
      // Expecting data to be an array of objects with systemid property
      return data;
    } catch (error) {
      console.error('Error fetching user systems:', error);
      return [];
    }
  }
  
  /**
   * Handle a successful Cognito sign-in
   */
  async function handleSuccessfulSignIn(username: string): Promise<User | null> {
    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken?.toString() || '';
      const accessToken = session.tokens?.accessToken?.toString() || '';
  
      if (!idToken || !accessToken) throw new Error('Missing tokens in session.');
  
      const userInfo = await getAmpUser();
      const userId = userInfo.userId; // This is the Cognito sub value
      
      console.log(`Fetching user data from backend for userId: ${userId}`);
      
      // Fetch user profile and systems from DynamoDB backend
      const [userProfile, userSystems] = await Promise.all([
        fetchUserProfile(userId),
        fetchUserSystems(userId)
      ]);

      if (!userProfile) {
        console.error('Failed to fetch user profile from backend');
        throw new Error('Failed to fetch user profile');
      }

      const user: User = {
        id: userProfile.username, // Use username as id as specified
        username: userProfile.username,
        name: userProfile.name,
        email: userProfile.email,
        role: userProfile.role,
        systems: userSystems
      };
  
      await save(AUTH_USER_KEY, JSON.stringify(user));
      if (idToken) await save(ID_TOKEN_KEY, idToken);
      if (accessToken) await save(ACCESS_TOKEN_KEY, accessToken);
  
      // Register device with backend (fire and forget, don't block user experience)
      registerDeviceWithBackend(user.id).catch(error => {
        console.log('Device registration failed (non-blocking):', error);
      });
  
      console.log('User signed in successfully:', user.username);
      console.log('User has access to systems:', user.systems);

      return user;
    } catch (err: any) {
      console.error('Error handling successful sign in:', err.message);
      return null;
    }
  }
  
  /**
   * Sign out user
   */
  export async function signOut(): Promise<void> {
    try {
      // Get current user to extract user ID for device deletion
      const currentUser = await getCurrentUser();
      
      if (currentUser) {
        // Delete device registration from backend (fire and forget, don't block sign out)
        deleteDeviceFromBackend(currentUser.id).catch(error => {
          console.log('Device deletion failed during sign out (non-blocking):', error);
        });
      }
      
      await amplifySignOut();
      await deleteValueFor(AUTH_USER_KEY);
      await deleteValueFor(ACCESS_TOKEN_KEY);
      await deleteValueFor(ID_TOKEN_KEY);
      router.replace('/');
    } catch (error) {
      console.error('Sign out error:', error);
      throw error;
    }
  }
  
  /**
   * Get the current authenticated user
   */
  export async function getCurrentUser(): Promise<User | null> {
    const cached = await getValueFor(AUTH_USER_KEY);
    if (cached) return JSON.parse(cached);
  
    try {
      const userInfo = await getAmpUser();
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken?.toString() || '';
      const accessToken = session.tokens?.accessToken?.toString() || '';
      
      const userId = userInfo.userId; // This is the Cognito sub value
      
      console.log(`Fetching user data from backend for userId: ${userId}`);
      
      // Fetch user profile and systems from DynamoDB backend
      const [userProfile, userSystems] = await Promise.all([
        fetchUserProfile(userId),
        fetchUserSystems(userId)
      ]);

      if (!userProfile) {
        console.error('Failed to fetch user profile from backend');
        return null;
      }

      const user: User = {
        id: userProfile.username, // Use username as id as specified
        username: userProfile.username,
        name: userProfile.name,
        email: userProfile.email,
        role: userProfile.role,
        systems: userSystems
      };
  
      await save(AUTH_USER_KEY, JSON.stringify(user));
      if (idToken) await save(ID_TOKEN_KEY, idToken);
      if (accessToken) await save(ACCESS_TOKEN_KEY, accessToken);
  
      // Register device with backend (fire and forget, don't block user experience)
      registerDeviceWithBackend(user.id).catch(error => {
        console.log('Device registration failed (non-blocking):', error);
      });
  
      return user;
    } catch (error) {
      console.error('Error getting current user:', error);
      return null;
    }
  }
  
  /**
   * Check if a user has access to a system
   */
  export async function hasSystemAccess(userId: string, systemId: string): Promise<boolean> {
    const user = await getCurrentUser();
    if (user?.role === 'admin') return true;
  
    return user?.systems.includes(systemId) || false;
  }
  
  /**
   * Get all systems the user has access to
   */
  export async function getAccessibleSystems(userId: string): Promise<string[]> {
    const user = await getCurrentUser();
    if (user?.role === 'admin') return [];
  
    return user?.systems || [];
  }
  
  /**
   * Check if current session is valid
   */
  export async function isSessionValid(): Promise<boolean> {
    try {
      await getAmpUser();
      const session = await fetchAuthSession();
      return !!session.tokens;
    } catch {
      return false;
    }
  }
  
  /**
   * Get stored auth tokens
   */
  export async function getAuthTokens(): Promise<{ accessToken: string | null; idToken: string | null }> {
    const accessToken = await getValueFor(ACCESS_TOKEN_KEY);
    const idToken = await getValueFor(ID_TOKEN_KEY);
  
    if (accessToken && idToken) return { accessToken, idToken };
  
    try {
      const session = await fetchAuthSession();
      const newAccess = session.tokens?.accessToken?.toString() || null;
      const newId = session.tokens?.idToken?.toString() || null;
  
      if (newAccess) await save(ACCESS_TOKEN_KEY, newAccess);
      if (newId) await save(ID_TOKEN_KEY, newId);
  
      return { accessToken: newAccess, idToken: newId };
    } catch {
      return { accessToken: null, idToken: null };
    }
  }
  
  /**
   * Cleanup on startup
   */
  export async function initAuth(): Promise<void> {
    const isValid = await isSessionValid();
    if (!isValid) {
      await deleteValueFor(AUTH_USER_KEY);
      await deleteValueFor(ACCESS_TOKEN_KEY);
      await deleteValueFor(ID_TOKEN_KEY);
    }
  }
  
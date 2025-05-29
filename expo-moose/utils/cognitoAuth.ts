import {
    fetchAuthSession,
    signIn as amplifySignIn,
    signOut as amplifySignOut,
    getCurrentUser as getAmpUser,
    confirmSignIn
  } from 'aws-amplify/auth';
  import { router } from 'expo-router';
  import { save, getValueFor, deleteValueFor } from './secureStore';
  
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
  }
  
  // Temporary system access
  const systemAccess = [
    {
      userId: '2',
      systemIds: [
        "bf915090-5f59-4128-a206-46c73f2f779d",
        "f2fafda2-9b07-40e3-875f-db6409040b9c"
      ]
    }
  ];
  
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
      try {
        const testResponse = await fetch('https://httpbin.org/get');
        console.log('Network test successful, status:', testResponse.status);
      } catch (networkError) {
        console.error('Network test failed:', networkError);
      }

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
   * Handle a successful Cognito sign-in
   */
  async function handleSuccessfulSignIn(username: string): Promise<User | null> {
    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken?.toString() || '';
      const accessToken = session.tokens?.accessToken?.toString() || '';
  
      if (!idToken || !accessToken) throw new Error('Missing tokens in session.');
  
      const userInfo = await getAmpUser();
      const email = userInfo.signInDetails?.loginId || '';
      const name = userInfo.username || username;
  
      let role: 'admin' | 'user' = 'user';
      const adminUsernames = ['admin', 'administrator'];
      if (adminUsernames.includes(username.toLowerCase())) role = 'admin';
  
      const user: User = {
        id: userInfo.userId,
        username,
        name,
        email,
        role
      };
  
      await save(AUTH_USER_KEY, JSON.stringify(user));
      await save(ACCESS_TOKEN_KEY, accessToken);
      await save(ID_TOKEN_KEY, idToken);
  
      console.log('User signed in successfully:', user.username);
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
  
      const user: User = {
        id: userInfo.userId,
        username: userInfo.username || '',
        name: userInfo.username || '',
        email: userInfo.signInDetails?.loginId || '',
        role: 'user'
      };
  
      await save(AUTH_USER_KEY, JSON.stringify(user));
      if (idToken) await save(ID_TOKEN_KEY, idToken);
      if (accessToken) await save(ACCESS_TOKEN_KEY, accessToken);
  
      return user;
    } catch {
      return null;
    }
  }
  
  /**
   * Check if a user has access to a system
   */
  export async function hasSystemAccess(userId: string, systemId: string): Promise<boolean> {
    const user = await getCurrentUser();
    if (user?.role === 'admin') return true;
  
    const access = systemAccess.find(a => a.userId === userId);
    return access ? access.systemIds.includes(systemId) : false;
  }
  
  /**
   * Get all systems the user has access to
   */
  export async function getAccessibleSystems(userId: string): Promise<string[]> {
    const user = await getCurrentUser();
    if (user?.role === 'admin') return [];
  
    const access = systemAccess.find(a => a.userId === userId);
    return access ? access.systemIds : [];
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
  
import React, { createContext, useContext, useState, useEffect } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { AUTH_TOKEN_KEY, AUTH_USER_KEY, authenticate, User } from "./auth";
import { deleteValueFor, getValueFor, save } from "./secureStore";

// Define types for the session context
type SessionContextType = {
  session: User | null;
  isLoading: boolean;
  signIn: (username: string, password: string) => Promise<User | null>;
  signOut: () => Promise<void>;
};

// Create a context with default values
const SessionContext = createContext<SessionContextType>({
  session: null,
  isLoading: true,
  signIn: async () => null,
  signOut: async () => {},
});

// Custom hook to use the session context
export function useSession() {
  return useContext(SessionContext);
}

// The session provider component
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load the session from secure storage on component mount
  useEffect(() => {
    const loadSession = async () => {
      setIsLoading(true);
      try {
        const userJson = await getValueFor(AUTH_USER_KEY);
        if (userJson) {
          const userData = JSON.parse(userJson);
          setSession(userData);
        }
      } catch (error) {
        console.error("Error loading session:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSession();
  }, []);

  // Sign in function
  const signIn = async (username: string, password: string) => {
    try {
      const user = await authenticate(username, password);
      setSession(user);
      return user;
    } catch (error) {
      console.error("Sign in error:", error);
      return null;
    }
  };

  // Sign out function
  const signOut = async () => {
    try {
      // Remove auth token and user data
      await deleteValueFor(AUTH_TOKEN_KEY);
      await deleteValueFor(AUTH_USER_KEY);
      setSession(null);
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  return (
    <SessionContext.Provider value={{ session, isLoading, signIn, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

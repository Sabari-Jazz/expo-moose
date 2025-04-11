import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import { Platform } from 'react-native'

// Supabase URLs and keys
export const supabaseUrl = 'https://omitujixaqghnemgvyfy.supabase.co'
export const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9taXR1aml4YXFnaG5lbWd2eWZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQzMDYyMzcsImV4cCI6MjA1OTg4MjIzN30._GF_I3kqGVVfBltBSuxrEbaSvE6LdlcB40qDq38WLLI'

// Create a custom fetch function with better error handling and retries
const customFetch = async (url: RequestInfo | URL, options?: RequestInit) => {
  console.log(`Making fetch request to ${url.toString()}`);
  
  // Add specific headers for React Native
  const modifiedOptions = {
    ...options,
    headers: {
      ...options?.headers,
      'X-Client-Info': 'supabase-js-react-native',
      'Content-Type': 'application/json',
      'apikey': supabaseAnonKey,
      'Authorization': `Bearer ${supabaseAnonKey}`
    },
  };
  
  // For iOS simulator, log additional info
  if (Platform.OS === 'ios') {
    console.log('Using iOS-specific fetch options with API key authentication');
  }
  
  // Implement retry logic
  const maxRetries = 3;
  let retryCount = 0;
  let lastError = null;
  
  while (retryCount < maxRetries) {
    try {
      const response = await fetch(url, modifiedOptions);
      
      // Log response status
      console.log(`Response status: ${response.status} for ${url.toString()}`);
      
      if (response.ok) {
        return response;
      } else {
        // Log the error response for debugging
        const errorData = await response.text();
        console.error(`Error response (${response.status}):`, errorData);
        
        // If we got a 401 or 403, retry with explicitly forced headers
        if (response.status === 401 || response.status === 403) {
          console.log(`Auth error (${response.status}), retrying with explicit auth...`);
          
          // Force authentication headers even stronger
          modifiedOptions.headers = {
            ...modifiedOptions.headers,
            'apikey': supabaseAnonKey,
            'Authorization': `Bearer ${supabaseAnonKey}`,
            'Prefer': 'return=minimal'
          };
          
          retryCount++;
          await new Promise(r => setTimeout(r, 500 * retryCount)); // Exponential backoff
          continue;
        }
        
        return response; // Return the error response to be handled by the Supabase client
      }
    } catch (error) {
      console.error(`Fetch attempt ${retryCount + 1} failed:`, error);
      lastError = error;
      retryCount++;
      
      if (retryCount < maxRetries) {
        // Exponential backoff
        await new Promise(r => setTimeout(r, 500 * retryCount));
      }
    }
  }
  
  // If we're here, all retries failed
  console.error(`All ${maxRetries} fetch attempts failed`);
  throw lastError;
};

// Create the Supabase client
export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    global: {
      fetch: customFetch,
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
    },
  }
)

// Test Supabase connectivity
export const testSupabaseConnection = async (): Promise<boolean> => {
  try {
    console.log('Testing Supabase connection...');
    
    // Try to access a public endpoint
    const { data, error } = await supabase.from('feedback').select('count', {
      count: 'exact',
      head: true,
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
      }
    });
    
    if (error) {
      console.error('Supabase connection test failed:', error);
      return false;
    }
    
    console.log('Supabase connection successful!');
    return true;
  } catch (error) {
    console.error('Supabase connection test error:', error);
    return false;
  }
};

// Run the test immediately
testSupabaseConnection()
  .then(isConnected => {
    console.log(`Supabase connection status: ${isConnected ? 'Connected' : 'Failed'}`);
  });

// Function to directly create the feedback table without using RPC
export const createFeedbackTableIfNotExists = async (): Promise<boolean> => {
  try {
    console.log('Creating feedback table if it does not exist...');
    
    // SQL statement to create the table if it doesn't exist
    const sql = `
      CREATE TABLE IF NOT EXISTS public.feedback (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'resolved')),
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `;
    
    // Execute the SQL directly
    const { error } = await supabase.rpc('exec_sql', { sql_query: sql }, {
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
      }
    });
    
    if (error) {
      console.error('Error creating feedback table:', error);
      
      const { error: checkError } = await supabase
        .from('feedback')
        .select('count', {
          count: 'exact',
          head: true,
          headers: {
            'apikey': supabaseAnonKey,
            'Authorization': `Bearer ${supabaseAnonKey}`,
          }
        });
      
      if (checkError && checkError.code === '42P01') {
        console.error('Feedback table does not exist and could not be created');
        return false;
      } else if (!checkError) {
        console.log('Feedback table already exists');
        return true;
      }
      
      return false;
    }
    
    console.log('Feedback table created or verified successfully');
    return true;
  } catch (error) {
    console.error('Error creating feedback table:', error);
    return false;
  }
};

Promise.all([
  testSupabaseConnection(),
  createFeedbackTableIfNotExists()
])
  .then(([isConnected, tableCreated]) => {
    console.log(`Supabase connection status: ${isConnected ? 'Connected' : 'Failed'}`);
    console.log(`Feedback table status: ${tableCreated ? 'Created/Exists' : 'Failed to create'}`);
  })
  .catch(error => {
    console.error('Error during initialization:', error);
  }); 
import axios from 'axios';
import { getAuthTokens } from './cognitoAuth';
import { API_URL } from '@/constants/api';

// Lambda backend URL - use the same URL as your main API
const LAMBDA_API_URL = process.env.LAMBDA_API_URL || API_URL;

/**
 * Create an authenticated API client for Lambda backend
 * This automatically adds the JWT token to all requests
 */
export async function createAuthenticatedClient() {
  const { idToken } = await getAuthTokens();
  
  const apiClient = axios.create({
    baseURL: LAMBDA_API_URL,
    headers: {
      'Content-Type': 'application/json',
      // Add JWT token if available
      ...(idToken ? { 'Authorization': `Bearer ${idToken}` } : {})
    }
  });
  
  // Add request interceptor to dynamically update the token
  apiClient.interceptors.request.use(async (config) => {
    // Get fresh tokens for each request
    const { idToken: freshToken } = await getAuthTokens();
    
    if (freshToken) {
      config.headers.Authorization = `Bearer ${freshToken}`;
    }
    
    return config;
  });
  
  return apiClient;
}

/**
 * Make an authenticated request to the Lambda backend
 * @param endpoint API endpoint
 * @param method HTTP method
 * @param data Request data
 * @returns API response
 */
export async function callLambdaApi<T = any>(
  endpoint: string, 
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  data?: any
): Promise<T> {
  const client = await createAuthenticatedClient();
  
  try {
    let response;
    
    switch (method) {
      case 'GET':
        response = await client.get<T>(endpoint);
        break;
      case 'POST':
        response = await client.post<T>(endpoint, data);
        break;
      case 'PUT':
        response = await client.put<T>(endpoint, data);
        break;
      case 'DELETE':
        response = await client.delete<T>(endpoint);
        break;
    }
    
    return response.data;
  } catch (error) {
    console.error('Lambda API request failed:', error);
    throw error;
  }
}

/**
 * Send a message to the chatbot
 * @param message User message
 * @returns Chatbot response
 */
export async function sendChatbotMessage(message: string): Promise<{ response: string }> {
  return callLambdaApi<{ response: string }>('/chatbot', 'POST', { message });
}

// Export any other API functions you need 
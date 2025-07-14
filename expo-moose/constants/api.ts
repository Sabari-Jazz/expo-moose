// Development host configuration
// Change this to your development machine's IP address when testing on physical devices
// Examples:
// - Use 'localhost' when testing in web or iOS simulator
// - Use '10.0.2.2' when testing in Android emulator
// - Use your machine's actual IP (e.g., '192.168.1.5') when testing on physical devices
// API URL for development and production
// export const DEV_API_HOST = '172.17.161.41'; // Your actual development machine IP
//export const DEV_API_HOST = '10.0.0.210'

/*export const API_URL = __DEV__ 
  ? `http://${DEV_API_HOST}:8000` // Development API URL
  : 'https://api.solarmonitor.app';
*/
export const API_URL = 'https://vfcfg6edj6.execute-api.us-east-1.amazonaws.com/'
//export const API_URL = '172.20.10.2:8000'
// Add API_BASE_URL for SolarWeb API
export const API_BASE_URL = process.env.API_BASE_URL || 'https://api.solarweb.com/swqapi';

// Websocket URL for real-time communication
/*
export const WS_URL = __DEV__
  ? `ws://${DEV_API_HOST}:8000/ws`
  : 'wss://api.solarmonitor.app/ws';
  */

// API endpoints
export const ENDPOINTS = {
  // Authentication
  LOGIN: '/api/auth/login',
  REGISTER: '/api/auth/register',
  RESET_PASSWORD: '/api/auth/reset-password',
  
  // Systems
  SYSTEMS: '/api/systems',
  SYSTEM_DETAIL: (id: string) => `/api/system/${id}`,
  ENERGY_FLOW: (id: string) => `/api/system/${id}/energy-flow`,
  
  // Chat
  CHAT: '/api/chat',
  
  // Reports
  REQUEST_REPORT: '/api/request-report',
  REQUEST_MONTHLY_REPORT: '/api/request-monthly-report',
  
  // User
  USER_PROFILE: '/api/user/profile',
  
  // SolarWeb API endpoints
  SOLARWEB: {
    JWT: '/iam/jwt',
    PV_SYSTEMS: '/pvsystems',
    PV_SYSTEM_DETAIL: (id: string) => `/pvsystems/${id}`,
    PV_SYSTEM_DEVICES: (id: string) => `/pvsystems/${id}/devices`,
    PV_SYSTEM_FLOW_DATA: (id: string) => `/pvsystems/${id}/flowdata`,
    PV_SYSTEM_MESSAGES: (id: string) => `/pvsystems/${id}/messages`,
    PV_SYSTEM_WEATHER: (id: string) => `pvsystems/${id}/weather/current`,
    PV_SYSTEM_AGGR_DATA: (id: string) => `/pvsystems/${id}/aggrdata`,
  }
}; 
import { createClient } from '@supabase/supabase-js';
import Constants from "expo-constants";

// create the supabaseClient to connect with hosted postgres db
const supabaseUrl = 'https://vemtgbvseyegqxychrzm.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlbXRnYnZzZXllZ3F4eWNocnptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDYwMTY1ODMsImV4cCI6MjA2MTU5MjU4M30.T8SFfZ2Ai1O77eNRQnKWk-_I9tePCjflJ4utGZKuBq4';
export const supabase = createClient(supabaseUrl, supabaseAnonKey);


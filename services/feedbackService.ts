import { supabase } from '../utils/supabase';
import { Platform } from 'react-native';

// Import Supabase credentials for direct use in headers
import { supabaseUrl, supabaseAnonKey, createFeedbackTableIfNotExists } from '../utils/supabase';

// Define the feedback item interface
export interface FeedbackItem {
  id?: string;
  ticketId: string;
  name: string;
  email: string;
  message: string;
  timestamp: number;
  status: 'pending' | 'resolved';
}

// Interface for database schema (using snake_case to match Supabase)
interface FeedbackItemDB {
  id?: string;
  ticket_id: string;
  name: string;
  email: string;
  message: string;
  timestamp: number;
  status: 'pending' | 'resolved';
}

// Counter for ticket IDs
let ticketCounter = 1000;

// Generate a ticket ID (format: TICKET-XXXXX)
export const generateTicketId = (): string => {
  // Increment the ticket counter for each new ticket
  ticketCounter++;
  return `TICKET-${String(ticketCounter).padStart(4, '0')}`;
};

// Local storage fallback for when database isn't available
let localFeedbackStore: FeedbackItem[] = [];

/**
 * Upload feedback data to Supabase
 */
export const uploadFeedback = async (feedbackData: {
  name: string;
  email: string;
  message: string;
  timestamp?: string; // For compatibility with existing code
}): Promise<{ ticketId: string }> => {
  try {
    // Basic connectivity check - fast fail if network is clearly unavailable
    try {
      // Simple promise race for timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Network connectivity timeout')), 5000)
      );
      
      // Fetch request
      const fetchPromise = fetch('https://www.google.com', { method: 'HEAD' });
      
      // Race between fetch and timeout
      await Promise.race([fetchPromise, timeoutPromise])
        .catch(() => {
          console.log('Network connectivity check failed');
          // Don't throw on iOS (simulator often has special networking)
          if (Platform.OS !== 'ios') {
            throw new Error('Network connectivity check failed. Please check your internet connection.');
          }
        });
    } catch (networkError) {
      if (Platform.OS !== 'ios') { // Only log for non-iOS platforms
        console.error('Network connectivity test failed:', networkError);
      }
    }

    const ticketId = generateTicketId();
    
    // Create feedback item - always store local copy as backup
    const feedbackItem: FeedbackItem = {
      ticketId,
      name: feedbackData.name,
      email: feedbackData.email,
      message: feedbackData.message,
      timestamp: Date.now(),
      status: 'pending'
    };
    
    // Save to local storage as backup
    localFeedbackStore.push(feedbackItem);
    console.log(`Added feedback to local store (${localFeedbackStore.length} items stored locally)`);
    
    try {
      // Create snake_case version for database
      const dbFeedbackItem: FeedbackItemDB = {
        ticket_id: ticketId,
        name: feedbackData.name,
        email: feedbackData.email,
        message: feedbackData.message,
        timestamp: Date.now(),
        status: 'pending'
      };
      
      console.log('Uploading feedback to Supabase:', dbFeedbackItem);
      
      // First, try to create the table if it doesn't exist
      try {
        // Create the table if needed - in-memory fallback if can't reach Supabase
        const tableCreated = await createFeedbackTableIfNotExists();
        
        if (!tableCreated) {
          console.log('Unable to check/create table, will try to insert anyway');
        }
      } catch (tableError) {
        console.log('Error checking table existence:', tableError);
      }
      
      // Insert into Supabase with max 3 retries
      let retryCount = 0;
      let insertError = null;
      
      while (retryCount < 3) {
        try {
          const { data, error } = await supabase
            .from('feedback')
            .insert(dbFeedbackItem, {
              headers: {
                'apikey': supabaseAnonKey,
                'Authorization': `Bearer ${supabaseAnonKey}`,
              }
            })
            .select()
            .single();
          
          if (error) {
            insertError = error;
            console.error(`Attempt ${retryCount + 1}: Error uploading feedback to Supabase:`, error);
            retryCount++;
            await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
          } else {
            console.log('Feedback uploaded successfully to database:', data);
            return { ticketId };
          }
        } catch (e) {
          insertError = e;
          console.error(`Attempt ${retryCount + 1}: Exception during Supabase insert:`, e);
          retryCount++;
          await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
        }
      }
      
      // If we reach here, all retries failed
      console.log('All Supabase insert attempts failed, using local storage only');
    } catch (dbError) {
      console.error('Database error:', dbError);
      console.log('Continuing with local storage only');
    }
    
    // Still return the ticket ID even if database storage failed
    // The feedback is safely in local memory
    return { ticketId };
    
  } catch (error: any) {
    console.error('Error uploading feedback:', error?.message || String(error));
    throw new Error('Failed to store feedback: ' + (error?.message || String(error)));
  }
};

/**
 * Get all feedback items from Supabase
 */
export const getAllFeedback = async (): Promise<FeedbackItem[]> => {
  try {
    console.log('Fetching all feedback items from Supabase');
    
    try {
      // Query Supabase for all feedback items
      const { data, error } = await supabase
        .from('feedback')
        .select('*', {
          headers: {
            'apikey': supabaseAnonKey,
            'Authorization': `Bearer ${supabaseAnonKey}`,
          }
        })
        .order('timestamp', { ascending: false });
      
      if (error) {
        console.error('Error fetching feedback from Supabase:', error);
        // Continue to return local items only
      } else {
        // Map snake_case DB fields to camelCase for the app
        const dbItems = data?.map(item => ({
          id: item.id,
          ticketId: item.ticket_id,
          name: item.name, 
          email: item.email,
          message: item.message,
          timestamp: item.timestamp,
          status: item.status
        } as FeedbackItem)) || [];
        
        // Merge with local items, remove duplicates by ticketId
        const combinedItems = [...dbItems];
        
        // Add local items that aren't in the DB results
        for (const localItem of localFeedbackStore) {
          if (!dbItems.some(dbItem => dbItem.ticketId === localItem.ticketId)) {
            combinedItems.push(localItem);
          }
        }
        
        console.log(`Retrieved ${combinedItems.length} feedback items (${dbItems.length} from DB, ${localFeedbackStore.length} local)`);
        
        // Sort by timestamp
        const sortedItems = combinedItems.sort((a, b) => b.timestamp - a.timestamp);
        return sortedItems;
      }
    } catch (dbError) {
      console.error('Database error when fetching feedback:', dbError);
      // Continue to return local items only
    }
    
    // If we reach here, we couldn't get items from the database
    // So return local items only
    console.log(`Returning ${localFeedbackStore.length} feedback items from local storage only`);
    return [...localFeedbackStore].sort((a, b) => b.timestamp - a.timestamp);
    
  } catch (error: any) {
    console.error('Error retrieving feedback:', error?.message || String(error));
    return [...localFeedbackStore].sort((a, b) => b.timestamp - a.timestamp);
  }
};

/**
 * Delete feedback item from Supabase
 */
export const deleteFeedback = async (ticketId: string): Promise<boolean> => {
  try {
    console.log(`Deleting feedback with ticket ID: ${ticketId}`);
    
    // Delete from Supabase using ticket_id
    const { error } = await supabase
      .from('feedback')
      .delete({
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`,
        }
      })
      .eq('ticket_id', ticketId);
    
    if (error) {
      console.error(`Error deleting feedback ${ticketId}:`, error);
      return false;
    }
    
    console.log(`Feedback with ID ${ticketId} deleted successfully`);
    return true;
    
  } catch (error: any) {
    console.error(`Error deleting feedback ${ticketId}:`, error?.message || String(error));
    return false;
  }
};

/**
 * Update feedback status in Supabase
 */
export const updateFeedbackStatus = async (
  ticketId: string,
  status: 'pending' | 'resolved'
): Promise<boolean> => {
  try {
    console.log(`Updating feedback ${ticketId} status to ${status}`);
    
    // Update in Supabase using ticket_id
    const { error } = await supabase
      .from('feedback')
      .update({ status }, {
        headers: {
          'apikey': supabaseAnonKey,
          'Authorization': `Bearer ${supabaseAnonKey}`,
        }
      })
      .eq('ticket_id', ticketId);
    
    if (error) {
      console.error(`Error updating feedback ${ticketId}:`, error);
      return false;
    }
    
    console.log(`Feedback ${ticketId} status updated to ${status}`);
    return true;
    
  } catch (error: any) {
    console.error(`Error updating feedback ${ticketId}:`, error?.message || String(error));
    return false;
  }
};
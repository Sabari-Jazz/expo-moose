import { loadFeedbackFromStorage, saveFeedbackToStorage } from '../utils/localFeedbackStorage';
import { supabase } from '@/utils/supabase';
// Define the feedback item interface
export interface FeedbackItem {
  ticketId: string;
  name: string;
  email: string;
  message: string;
  timestamp: number;
  status: 'pending' | 'resolved';
  type: string;
  supabaseId: string;
}

export interface FeedbackItemSupabase {
  name: string;
  email: string;
  message: string;
  type: string;
  status: 'pending' | 'resolved';
}

// In-memory feedback store
let localFeedbackStore: FeedbackItem[] = [];

// Counter for ticket IDs
let ticketCounter = 1000;

// Generate a ticket ID (format: TICKET-XXXXX)
export const generateTicketId = (): string => {
  // Increment the ticket counter for each new ticket
  ticketCounter++;
  return `TICKET-${String(ticketCounter).padStart(4, '0')}`;
};

// Load the initial data
const initializeFeedbackStore = async () => {
  try {
    const storedFeedback = await loadFeedbackFromStorage();
    if (storedFeedback && Array.isArray(storedFeedback)) {
      localFeedbackStore = storedFeedback;
      
      // Find the highest ticket number to properly continue the sequence
      if (localFeedbackStore.length > 0) {
        const maxTicket = localFeedbackStore
          .map(item => parseInt(item.ticketId.replace('TICKET-', ''), 10))
          .reduce((max, current) => Math.max(max, current), 0);
        
        ticketCounter = Math.max(ticketCounter, maxTicket);
      }
      
      console.log(`Loaded ${localFeedbackStore.length} feedback items from storage`);
    }
  } catch (error) {
    console.error('Error initializing feedback store:', error);
  }
};

// Initialize on import
initializeFeedbackStore();

/**
 * Upload feedback data to local storage
 */
export const uploadFeedback = async (feedbackData: {
  name: string;
  email: string;
  message: string;
  type: string;
  supabaseId: string;
}): Promise<{ ticketId: string }> => {
  try {
    //console.log('inside', feedbackData.supabaseId)
    const ticketId = generateTicketId();
    
    // Create feedback item
    const feedbackItem: FeedbackItem = {
      ticketId,
      name: feedbackData.name,
      email: feedbackData.email,
      message: feedbackData.message,
      timestamp: Date.now(),
      status: 'pending',
      type: feedbackData.type,
      supabaseId: feedbackData.supabaseId
    };
    
    // Add to local store
    localFeedbackStore.push(feedbackItem);
    
    // Save to AsyncStorage
    await saveFeedbackToStorage(localFeedbackStore);
    
    console.log(`Added feedback to local store (${localFeedbackStore.length} items)`);
    return { ticketId };
    
  } catch (error: any) {
    console.error('Error saving feedback:', error?.message || String(error));
    throw new Error('Failed to store feedback: ' + (error?.message || String(error)));
  }
};

/**
 * Get all feedback items from local storage
 */
export const getAllFeedback = async (): Promise<FeedbackItem[]> => {
  try {
    // Reload from AsyncStorage to ensure we have the latest data
    const storedFeedback = await loadFeedbackFromStorage();
    if (storedFeedback && Array.isArray(storedFeedback)) {
      localFeedbackStore = storedFeedback;
    }
    
    // Return a sorted copy
    return [...localFeedbackStore].sort((a, b) => b.timestamp - a.timestamp);
  } catch (error: any) {
    console.error('Error retrieving feedback:', error?.message || String(error));
    return [...localFeedbackStore].sort((a, b) => b.timestamp - a.timestamp);
  }
};

/**
 * Delete feedback item from local storage
 */
export const deleteFeedback = async (ticketId: string): Promise<boolean> => {
  try {
    // Remove from local store
    const initialLength = localFeedbackStore.length;
    // get item
    const item = localFeedbackStore.find(item => item.ticketId === ticketId);
    localFeedbackStore = localFeedbackStore.filter(item => item.ticketId !== ticketId);
    
    // Save updated list to AsyncStorage
    if (initialLength !== localFeedbackStore.length) {
      await saveFeedbackToStorage(localFeedbackStore);
      console.log(`Feedback with ID ${ticketId} deleted successfully`);
      if(item) {
        deleteFeedbackSupabase(item.supabaseId); // delete from supabase
      }
    
      return true;
    } else {
      console.log(`Feedback with ID ${ticketId} not found`);
      return false;
    }
    
  } catch (error: any) {
    console.error(`Error deleting feedback ${ticketId}:`, error?.message || String(error));
    return false;
  }
};

/**
 * Update feedback status in local storage
 */
export const updateFeedbackStatus = async (
  ticketId: string,
  status: 'pending' | 'resolved'
): Promise<boolean> => {
  try {
    // Find and update the item
    const found = localFeedbackStore.find(item => item.ticketId === ticketId);
    
    if (found) {
      found.status = status;
      
      // Save the updated list to local and supabase
      await saveFeedbackToStorage(localFeedbackStore);
      await updateFeedbackStatusSupabase(found.supabaseId, status);
      console.log(`Feedback ${ticketId} status updated to ${status}`);
      return true;
    } else {
      console.log(`Feedback ${ticketId} not found for status update`);
      return false;
    }
    
  } catch (error: any) {
    console.error(`Error updating feedback ${ticketId}:`, error?.message || String(error));
    return false;
  }
};
// upload the entry to supabase 
export async function uploadFeedbackSupabase(feedbackData: {
  name: string;
  email: string;
  message: string;
  type: string;
  supabaseId: string;
}) {
  const feedbackItem: FeedbackItemSupabase = {
    name: feedbackData.name,
    email: feedbackData.email,
    message: feedbackData.message,
    type: feedbackData.type,
    status: 'pending'
  };
  const { data, error } = await supabase
    .from('feedback')
    .insert([feedbackItem])
    .select(); 

  if (error) throw new Error(`Insert failed: ${error.message}`);
  // upload into local
  feedbackData['supabaseId'] = data[0].id
  const result = await uploadFeedback(feedbackData)
  return result;
}
// get all feedback from supabase
export async function selectAllFeedback() {
  const { data, error } = await supabase
    .from('feedback')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Select failed: ${error.message}`);
  return data;
}
//update feedback status in supabase
export async function updateFeedbackStatusSupabase(
  id: string,
  status: 'pending' | 'resolved'
) {
  const { data, error } = await supabase
    .from('feedback')
    .update({ status: status})
    .eq('id', id);

  if (error) {
    console.log('ID', id);
    console.error('Error updating feedback:', error.message);
    return null;
  }

  return data;
}
export async function deleteFeedbackSupabase(id: string) {
  const { data, error } = await supabase
    .from('feedback')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting feedback:', error.message);
    return null;
  }

  return data;
}
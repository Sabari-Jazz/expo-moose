import { loadFeedbackFromStorage, saveFeedbackToStorage } from '../utils/localFeedbackStorage';

// Define the feedback item interface
export interface FeedbackItem {
  ticketId: string;
  name: string;
  email: string;
  message: string;
  timestamp: number;
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
}): Promise<{ ticketId: string }> => {
  try {
    const ticketId = generateTicketId();
    
    // Create feedback item
    const feedbackItem: FeedbackItem = {
      ticketId,
      name: feedbackData.name,
      email: feedbackData.email,
      message: feedbackData.message,
      timestamp: Date.now(),
      status: 'pending'
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
    localFeedbackStore = localFeedbackStore.filter(item => item.ticketId !== ticketId);
    
    // Save updated list to AsyncStorage
    if (initialLength !== localFeedbackStore.length) {
      await saveFeedbackToStorage(localFeedbackStore);
      console.log(`Feedback with ID ${ticketId} deleted successfully`);
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
      
      // Save the updated list
      await saveFeedbackToStorage(localFeedbackStore);
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
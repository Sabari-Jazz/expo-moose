import { supabase } from '@/utils/supabase';

// Define interfaces for error code data
export interface ErrorCode {
  id: number;
  code: number;
  description: string;
  colour: 'red' | 'yellow' | 'green';

}

// Map of color severity (higher number = more severe)
const COLOR_SEVERITY: Record<string, number> = {
  'red': 3,
  'yellow': 2,
  'green': 1
};

/**
 * Get error code information for one or multiple codes
 * @param codes - Single error code or array of error codes
 */
export const getErrorCodesInfo = async (codes: number | number[]): Promise<ErrorCode[]> => {
  // Convert single code to array if needed
  const codeArray = Array.isArray(codes) ? codes : [codes];
  
  if (!codeArray.length) {
    console.log("ErrorCodesService: Empty array of codes provided");
    return [];
  }
  
  try {
    console.log(`ErrorCodesService: Fetching info for ${codeArray.length} error codes:`, codeArray);
    
    const { data, error } = await supabase
      .from('error_codes')
      .select('*')
      .in('code', codeArray);

    if (error) {
      console.error('ErrorCodesService: Error fetching error codes:', error.message);
      return [];
    }

    if (!data || !Array.isArray(data)) {
      console.log('ErrorCodesService: No data returned from Supabase or invalid format');
      return [];
    }

    console.log(`ErrorCodesService: Found ${data.length} error codes in database`);
    return data as ErrorCode[];
  } catch (error: any) {
    console.error('ErrorCodesService: Error in getErrorCodesInfo:', error?.message || String(error));
    return [];
  }
};

/**
 * Determine the most severe color from a list of error codes
 * Priority: red > yellow > green
 */
export const getMostSevereColor = (errorCodes: ErrorCode[]): 'red' | 'yellow' | 'green' | null => {
  if (!errorCodes || !errorCodes.length) {
    console.log('ErrorCodesService: No error codes provided to getMostSevereColor');
    return null;
  }
  
  // Default to green (least severe)
  let mostSevereColor: 'red' | 'yellow' | 'green' = 'green';
  let highestSeverity = COLOR_SEVERITY['green'];
  
  for (const errorCode of errorCodes) {
    // Skip if color is missing or invalid
    if (!errorCode.colour || !COLOR_SEVERITY[errorCode.colour]) {
      console.warn(`ErrorCodesService: Invalid color for error code ${errorCode.code}: ${errorCode.colour}`);
      continue;
    }
    
    const currentSeverity = COLOR_SEVERITY[errorCode.colour];
    if (currentSeverity > highestSeverity) {
      highestSeverity = currentSeverity;
      mostSevereColor = errorCode.colour;
      
      // If we found red, we can stop since it's the most severe
      if (mostSevereColor === 'red') break;
    }
  }
  
  console.log(`ErrorCodesService: Most severe color determined: ${mostSevereColor}`);
  return mostSevereColor;
};

/**
 * Get the most severe color for a list of error codes
 */
export const getColorForErrorCodes = async (codes: number[]): Promise<'red' | 'yellow' | 'green' | null> => {
  if (!codes || !codes.length) {
    console.log('ErrorCodesService: No codes provided to getColorForErrorCodes');
    return null;
  }
  
  const errorCodesInfo = await getErrorCodesInfo(codes);
  return getMostSevereColor(errorCodesInfo);
}; 
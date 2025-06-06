"""
System Profile Data Loader

This script loads PV system profile data from the Solar.web API and stores it in DynamoDB.
Each system gets an entry with PK: System#<SystemId> and SK: PROFILE containing all system metadata.

Usage:
    python load.py

Environment Variables:
    - SOLAR_WEB_ACCESS_KEY_ID: API access key ID
    - SOLAR_WEB_ACCESS_KEY_VALUE: API access key value
    - SOLAR_WEB_USERID: Solar.web user ID
    - SOLAR_WEB_PASSWORD: Solar.web password
    - AWS_REGION: AWS region (default: us-east-1)
    - DYNAMODB_TABLE_NAME: DynamoDB table name (default: Moose-DDB)
"""

import os
import json
import logging
import requests
import boto3
import time
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from botocore.exceptions import ClientError
from decimal import Decimal

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('system_loader')

# Configuration with validation
def validate_env_vars():
    """Validate required environment variables"""
    required_vars = ['SOLAR_WEB_ACCESS_KEY_ID', 'SOLAR_WEB_ACCESS_KEY_VALUE', 
                    'SOLAR_WEB_USERID', 'SOLAR_WEB_PASSWORD']
    missing_vars = [var for var in required_vars if not os.environ.get(var)]
    if missing_vars:
        logger.warning(f"Missing environment variables: {missing_vars}. Using defaults.")

validate_env_vars()

# API Configuration
API_BASE_URL = os.environ.get('API_BASE_URL', 'https://api.solarweb.com/swqapi')
ACCESS_KEY_ID = os.environ.get('SOLAR_WEB_ACCESS_KEY_ID', 'FKIA08F3E94E3D064B629EE82A44C8D1D0A6')
ACCESS_KEY_VALUE = os.environ.get('SOLAR_WEB_ACCESS_KEY_VALUE', '2f62d6f2-77e6-4796-9fd1-5d74b5c6474c')
USER_ID = os.environ.get('SOLAR_WEB_USERID', 'monitoring@jazzsolar.com')
PASSWORD = os.environ.get('SOLAR_WEB_PASSWORD', 'solar123')

# AWS Configuration
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
DYNAMODB_TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'Moose-DDB')

# Rate limiting configuration
REQUEST_DELAY = float(os.environ.get('API_REQUEST_DELAY', '0.0'))  # Seconds between requests
MAX_RETRIES = int(os.environ.get('MAX_RETRIES', '3'))

# Initialize DynamoDB client
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
table = dynamodb.Table(DYNAMODB_TABLE_NAME)

# JWT token cache
_jwt_token_cache = {
    'token': None,
    'expires_at': None
}


def get_jwt_token() -> str:
    """
    Get a JWT token for authentication with the Solar.web API with caching
    """
    global _jwt_token_cache
    
    # Check if we have a valid cached token
    if (_jwt_token_cache['token'] and _jwt_token_cache['expires_at'] and 
        datetime.utcnow() < _jwt_token_cache['expires_at']):
        logger.debug("Using cached JWT token")
        return _jwt_token_cache['token']
    
    endpoint = f"{API_BASE_URL}/iam/jwt"
    headers = {
        'Content-Type': 'application/json',
        'AccessKeyId': ACCESS_KEY_ID,
        'AccessKeyValue': ACCESS_KEY_VALUE
    }
    payload = {
        'UserId': USER_ID,
        'password': PASSWORD
    }
    
    for attempt in range(MAX_RETRIES):
        try:
            logger.info(f"Requesting JWT token from {endpoint} (attempt {attempt + 1})")
            response = requests.post(endpoint, headers=headers, json=payload, timeout=30)
            response.raise_for_status()
            
            data = response.json()
            if 'jwtToken' not in data:
                raise ValueError("JWT response is missing the jwtToken field")
            
            # Cache the token
            _jwt_token_cache['token'] = data['jwtToken']
            _jwt_token_cache['expires_at'] = datetime.utcnow() + timedelta(hours=1)
            
            logger.info("JWT Token obtained and cached successfully")
            return data['jwtToken']
            
        except requests.exceptions.RequestException as e:
            logger.warning(f"JWT request attempt {attempt + 1} failed: {str(e)}")
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)  # Exponential backoff
            else:
                raise
        except Exception as e:
            logger.error(f"Error obtaining JWT token: {str(e)}")
            raise


def api_request(endpoint: str, method: str = 'GET', params: Dict[str, Any] = None) -> Dict[str, Any]:
    """
    Make an authenticated request to the Solar.web API with retry logic and rate limiting
    """
    # Rate limiting
    time.sleep(REQUEST_DELAY)
    
    # Build the full URL
    if endpoint.startswith('/'):
        endpoint = endpoint[1:]
    
    url = f"{API_BASE_URL}/{endpoint}"
    
    # Build query string
    if params:
        query_parts = []
        for key, value in params.items():
            if value is not None:
                if isinstance(value, list):
                    query_parts.append(f"{key}={','.join(str(v) for v in value)}")
                else:
                    query_parts.append(f"{key}={value}")
        
        if query_parts:
            url += f"?{'&'.join(query_parts)}"
    
    for attempt in range(MAX_RETRIES):
        try:
            jwt_token = get_jwt_token()
            
            headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'AccessKeyId': ACCESS_KEY_ID,
                'AccessKeyValue': ACCESS_KEY_VALUE,
                'Authorization': f'Bearer {jwt_token}'
            }
            
            logger.info(f"Making API request to {url} with method {method} (attempt {attempt + 1})")
            
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=30)
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")
                
            response.raise_for_status()
            return response.json()
            
        except requests.exceptions.RequestException as e:
            logger.warning(f"API request attempt {attempt + 1} failed: {str(e)}")
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)  # Exponential backoff
            else:
                raise
        except Exception as e:
            logger.error(f"Error making API request to {url}: {str(e)}")
            raise


def get_all_pv_systems() -> List[Dict[str, Any]]:
    """
    Fetch all PV systems from the Solar.web API
    """
    try:
        logger.info("Fetching all PV systems from Solar.web API...")
        
        # Parameters for pagination - get a large number to get all systems
        params = {
            'offset': 0,
            'limit': 1000  # Adjust if you have more than 1000 systems
        }
        
        response = api_request('pvsystems', params=params)
        
        if 'pvSystems' not in response:
            logger.error("API response does not contain 'pvSystems' field")
            return []
        
        systems = response['pvSystems']
        logger.info(f"Successfully fetched {len(systems)} PV systems")
        
        return systems
        
    except Exception as e:
        logger.error(f"Error fetching PV systems: {str(e)}")
        raise


def convert_to_decimal(value: Any) -> Any:
    """
    Convert numeric values to Decimal for DynamoDB compatibility
    """
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    elif isinstance(value, dict):
        return {k: convert_to_decimal(v) for k, v in value.items()}
    elif isinstance(value, list):
        return [convert_to_decimal(item) for item in value]
    else:
        return value


def create_system_profile_entry(system_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create a DynamoDB entry for system profile data
    """
    try:
        # Extract system ID
        system_id = system_data['pvSystemId']
        
        # Create the profile entry
        profile_entry = {
            'PK': f'System#{system_id}',
            'SK': 'PROFILE',
            'systemId': system_id,
            'dataType': 'SYSTEM_PROFILE',
            'createdAt': datetime.utcnow().isoformat(),
            'updatedAt': datetime.utcnow().isoformat()
        }
        
        # Add all system data fields, converting numeric values to Decimal
        for key, value in system_data.items():
            if key == 'pvSystemId':
                continue  # Skip pvSystemId as we already have systemId
            elif key == 'address':
                # Flatten address object into separate fields
                if value and isinstance(value, dict):
                    address_fields = {
                        'country': value.get('country'),
                        'zipCode': value.get('zipCode'), 
                        'state': value.get('state'),
                        'city': value.get('city'),
                        'street': value.get('street')
                    }
                    
                    # Add each address field as a separate column
                    for addr_key, addr_value in address_fields.items():
                        profile_entry[addr_key] = convert_to_decimal(addr_value)
                else:
                    # If address is null or not a dict, set all address fields to null
                    profile_entry['country'] = None
                    profile_entry['zipCode'] = None
                    profile_entry['state'] = None
                    profile_entry['city'] = None
                    profile_entry['street'] = None
            else:
                # Handle other fields with original logic
                db_key = key
                if key == 'pictureURL':
                    db_key = 'pictureUrl'
                elif key == 'peakPower':
                    db_key = 'peakPower'
                elif key == 'installationDate':
                    db_key = 'installationDate'
                elif key == 'lastImport':
                    db_key = 'lastImport'
                elif key == 'meteoData':
                    db_key = 'meteoData'
                elif key == 'timeZone':
                    db_key = 'timeZone'
                
                profile_entry[db_key] = convert_to_decimal(value)
        
        return profile_entry
        
    except Exception as e:
        logger.error(f"Error creating profile entry for system {system_data.get('pvSystemId', 'unknown')}: {str(e)}")
        raise


def store_system_profile(profile_entry: Dict[str, Any]) -> bool:
    """
    Store a system profile entry in DynamoDB
    """
    try:
        table.put_item(Item=profile_entry)
        logger.info(f"Successfully stored profile for system {profile_entry['systemId']}")
        return True
        
    except Exception as e:
        logger.error(f"Error storing profile for system {profile_entry['systemId']}: {str(e)}")
        return False


def load_all_system_profiles():
    """
    Main function to load all system profiles from Solar.web API to DynamoDB
    """
    start_time = time.time()
    
    # Initialize statistics
    stats = {
        'systems_fetched': 0,
        'profiles_stored': 0,
        'errors': 0,
        'start_time': start_time
    }
    
    try:
        logger.info("=== STARTING SYSTEM PROFILE LOADING ===")
        
        # Fetch JWT token
        logger.info("Fetching JWT token...")
        get_jwt_token()
        
        # Get all PV systems from the API
        systems = get_all_pv_systems()
        stats['systems_fetched'] = len(systems)
        
        if not systems:
            logger.warning("No systems found to process")
            return stats
        
        logger.info(f"Processing {len(systems)} systems...")
        
        # Process each system
        for i, system_data in enumerate(systems, 1):
            try:
                system_id = system_data.get('pvSystemId', 'unknown')
                system_name = system_data.get('name', 'Unknown')
                
                logger.info(f"Processing system {i}/{len(systems)}: {system_name} ({system_id})")
                
                # Create profile entry
                profile_entry = create_system_profile_entry(system_data)
                
                # Store in DynamoDB
                if store_system_profile(profile_entry):
                    stats['profiles_stored'] += 1
                    logger.info(f"✅ Successfully processed system: {system_name}")
                else:
                    stats['errors'] += 1
                    logger.error(f"❌ Failed to store profile for system: {system_name}")
                
                # Add a small delay between operations to avoid overwhelming the database
                time.sleep(0.1)
                
            except Exception as e:
                stats['errors'] += 1
                logger.error(f"❌ Error processing system {system_data.get('pvSystemId', 'unknown')}: {str(e)}")
        
        end_time = time.time()
        execution_time = end_time - start_time
        
        logger.info("=== SYSTEM PROFILE LOADING COMPLETED ===")
        logger.info(f"⏱️  Total execution time: {execution_time:.2f} seconds")
        logger.info(f"🏭 Systems fetched: {stats['systems_fetched']}")
        logger.info(f"💾 Profiles stored: {stats['profiles_stored']}")
        logger.info(f"❌ Errors: {stats['errors']}")
        
        if stats['errors'] > 0:
            logger.warning(f"⚠️  Completed with {stats['errors']} errors")
        else:
            logger.info("✅ All system profiles loaded successfully!")
            
        return stats
        
    except Exception as e:
        logger.error(f"Critical error in profile loading: {str(e)}")
        stats['errors'] += 1
        return stats


if __name__ == "__main__":
    try:
        result = load_all_system_profiles()
        print("\n=== FINAL RESULTS ===")
        print(json.dumps(result, indent=2, default=str))
        
        # Exit with error code if there were errors
        if result['errors'] > 0:
            exit(1)
        else:
            exit(0)
            
    except Exception as e:
        logger.error(f"Script execution failed: {str(e)}")
        exit(1) 
"""
Solar Device Loading Script

This script interacts with the Fronius Solar.web Query API to:
- Retrieve all PV systems linked to the account
- Get all devices linked to those systems  
- Filter for only inverters
- For each inverter, generate a status entry and upload to DynamoDB

Usage:
- As a script: python load_devices.py
"""

import os
import json
import logging
import requests
import boto3
import time
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from decimal import Decimal
import botocore.config

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('load_devices')

# Configuration with validation
def validate_env_vars():
    """Validate required environment variables"""
    required_vars = ['SOLAR_WEB_ACCESS_KEY_ID', 'SOLAR_WEB_ACCESS_KEY_VALUE', 
                    'SOLAR_WEB_USERID', 'SOLAR_WEB_PASSWORD']
    missing_vars = [var for var in required_vars if not os.environ.get(var)]
    if missing_vars:
        logger.warning(f"Missing environment variables: {missing_vars}. Using defaults.")

validate_env_vars()

API_BASE_URL = os.environ.get('API_BASE_URL', 'https://api.solarweb.com/swqapi')
ACCESS_KEY_ID = os.environ.get('SOLAR_WEB_ACCESS_KEY_ID', 'FKIAD151D135048B4C709FFA341FF599BA72')
ACCESS_KEY_VALUE = os.environ.get('SOLAR_WEB_ACCESS_KEY_VALUE', '77619b46-d62d-495d-8a07-aeaa8cf4b228')
USER_ID = os.environ.get('SOLAR_WEB_USERID', 'monitoring@jazzsolar.com')
PASSWORD = os.environ.get('SOLAR_WEB_PASSWORD', 'solar123')

# AWS Configuration
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
DYNAMODB_TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'Moose-DDB')

# Configuration constants
MAX_RETRIES = int(os.environ.get('MAX_RETRIES', '3'))

# Initialize DynamoDB client
dynamodb_config = botocore.config.Config(
    max_pool_connections=50  # Increase from default 10 to handle concurrent operations
)
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION, config=dynamodb_config)
table = dynamodb.Table(DYNAMODB_TABLE_NAME)

# JWT token cache
_jwt_token_cache = {
    'token': None,
    'expires_at': None
}

class PvSystemMetadata:
    def __init__(self, pv_system_id: str, name: str):
        self.pv_system_id = pv_system_id
        self.name = name

def get_jwt_token() -> str:
    """Get a JWT token for authentication with the Solar.web API with caching"""
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
    """Make an authenticated request to the Solar.web API with retry logic"""
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
            
            logger.debug(f"Making API request to {url}")
            response = requests.get(url, headers=headers, timeout=30)
            
            # Handle rate limiting
            if response.status_code == 429:
                retry_after = int(response.headers.get('Retry-After', 60))
                logger.warning(f"Rate limited. Waiting {retry_after} seconds...")
                time.sleep(retry_after)
                continue
            
            response.raise_for_status()
            
            if response.status_code == 204:
                return {}
            
            return response.json()
            
        except requests.exceptions.RequestException as e:
            logger.warning(f"API request attempt {attempt + 1} failed: {str(e)}")
            if attempt < MAX_RETRIES - 1:
                time.sleep(2 ** attempt)
            else:
                logger.error(f"API request failed for endpoint {endpoint} after {MAX_RETRIES} attempts")
                raise
        except Exception as e:
            logger.error(f"Unexpected error in API request: {str(e)}")
            raise

def get_pv_systems() -> List[PvSystemMetadata]:
    """Get a list of all PV systems"""
    try:
        response = api_request('pvsystems?offset=0&limit=100')
        
        if not response or 'pvSystems' not in response:
            logger.warning("No PV systems found in the response")
            return []
        
        systems = []
        for system_data in response['pvSystems']:
            if 'pvSystemId' in system_data and 'name' in system_data:
                systems.append(PvSystemMetadata(
                    pv_system_id=system_data['pvSystemId'],
                    name=system_data['name']
                ))
            else:
                logger.warning(f"Invalid system data: {system_data}")
        
        logger.info(f"Found {len(systems)} PV systems")
        return systems
        
    except Exception as e:
        logger.error(f"Error getting PV systems: {str(e)}")
        raise

def get_system_devices(pv_system_id: str) -> List[Dict[str, Any]]:
    """Get all devices for a specific PV system"""
    try:
        endpoint = f"pvsystems/{pv_system_id}/devices"
        response = api_request(endpoint)
        
        if not response or 'devices' not in response:
            logger.warning(f"No devices found for system {pv_system_id}")
            return []
        
        devices = response['devices']
        logger.info(f"Found {len(devices)} devices for system {pv_system_id}")
        return devices
        
    except Exception as e:
        logger.error(f"Error getting devices for system {pv_system_id}: {str(e)}")
        return []

def filter_inverters(devices: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Filter devices to only return inverters"""
    inverters = []
    for device in devices:
        if device.get('deviceType') == 'Inverter':
            inverters.append(device)
    
    logger.info(f"Found {len(inverters)} inverters out of {len(devices)} devices")
    return inverters

def create_status_entry(device: Dict[str, Any], pv_system_id: str) -> Dict[str, Any]:
    """Create a status entry for an inverter device"""
    device_id = device.get('deviceId')
    current_time = datetime.utcnow().isoformat()
    
    status_entry = {
        "PK": f"Inverter#{device_id}",
        "SK": "STATUS",
        "pvSystemId": pv_system_id,
        "device_id": device_id,
        "lastUpdated": current_time,
        "lastStatusChangeTime": current_time,
        "status": "green"
    }
    
    return status_entry

def upload_status_entry_to_db(status_entry: Dict[str, Any]) -> bool:
    """Upload a single status entry to DynamoDB"""
    try:
        # Convert any float values to Decimal for DynamoDB compatibility
        ddb_entry = {}
        for key, value in status_entry.items():
            if isinstance(value, float):
                ddb_entry[key] = Decimal(str(value))
            else:
                ddb_entry[key] = value
        
        table.put_item(Item=ddb_entry)
        logger.info(f"✅ Uploaded status entry for device {status_entry['device_id']} to DynamoDB")
        return True
        
    except Exception as e:
        logger.error(f"❌ Error uploading status entry for device {status_entry['device_id']}: {str(e)}")
        return False

def load_devices() -> Dict[str, Any]:
    """Main function to load all devices, create status entries, and upload to DynamoDB"""
    logger.info("Starting device loading process...")
    
    stats = {
        'systems_processed': 0,
        'devices_found': 0,
        'inverters_found': 0,
        'entries_created': 0,
        'entries_uploaded': 0,
        'upload_errors': 0
    }
    
    # Step 1: Get all PV systems
    logger.info("Step 1: Getting all PV systems...")
    pv_systems = get_pv_systems()
    
    if not pv_systems:
        logger.warning("No PV systems found. Exiting.")
        return stats
    
    # Step 2: Get devices for each system and filter for inverters
    logger.info("Step 2: Getting devices for each system...")
    status_entries = []
    
    for system in pv_systems:
        logger.info(f"Processing system: {system.name} (ID: {system.pv_system_id})")
        stats['systems_processed'] += 1
        
        # Get all devices for this system
        devices = get_system_devices(system.pv_system_id)
        
        if not devices:
            logger.warning(f"No devices found for system {system.pv_system_id}")
            continue
        
        stats['devices_found'] += len(devices)
        
        # Filter for inverters only
        inverters = filter_inverters(devices)
        
        if not inverters:
            logger.warning(f"No inverters found for system {system.pv_system_id}")
            continue
        
        stats['inverters_found'] += len(inverters)
        
        # Create and upload status entries for each inverter
        for inverter in inverters:
            status_entry = create_status_entry(inverter, system.pv_system_id)
            status_entries.append(status_entry)
            stats['entries_created'] += 1
            
            # Upload to DynamoDB
            upload_success = upload_status_entry_to_db(status_entry)
            if upload_success:
                stats['entries_uploaded'] += 1
                logger.info(f"✅ Successfully processed inverter {inverter.get('deviceId')} in system {system.pv_system_id}")
            else:
                stats['upload_errors'] += 1
                logger.error(f"❌ Failed to upload inverter {inverter.get('deviceId')} in system {system.pv_system_id}")
    
    stats['total_entries'] = len(status_entries)
    logger.info(f"Device loading complete. Created {len(status_entries)} status entries, uploaded {stats['entries_uploaded']} successfully.")
    return stats

def main():
    """Main entry point"""
    try:
        start_time = time.time()
        
        logger.info("=== STARTING DEVICE LOADING AND UPLOAD PROCESS ===")
        stats = load_devices()
        
        end_time = time.time()
        execution_time = end_time - start_time
        
        # Print comprehensive summary
        print(f"\n=== DEVICE LOADING & UPLOAD SUMMARY ===")
        print(f"⏱️  Total execution time: {execution_time:.2f} seconds")
        print(f"🏭 Systems processed: {stats['systems_processed']}")
        print(f"🔧 Total devices found: {stats['devices_found']}")
        print(f"⚡ Inverters found: {stats['inverters_found']}")
        print(f"📝 Status entries created: {stats['entries_created']}")
        print(f"☁️  Entries uploaded to DynamoDB: {stats['entries_uploaded']}")
        print(f"❌ Upload errors: {stats['upload_errors']}")
        
        if stats['entries_uploaded'] > 0:
            success_rate = (stats['entries_uploaded'] / stats['entries_created']) * 100
            print(f"✅ Upload success rate: {success_rate:.1f}%")
        
        print("=" * 50)
        
        # Return the stats for potential use by other scripts
        return stats
        
    except Exception as e:
        logger.error(f"Error in main execution: {str(e)}")
        raise

if __name__ == "__main__":
    main() 
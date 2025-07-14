"""
AC Power Calculator Script

This script queries DynamoDB for all system profiles where PK begins with "System#" and SK = "PROFILE".
For each system, it calls the Solar.web API to get device information, calculates the total AC power
from all inverters by extracting and summing the power values from device names, and updates the
system profile with the calculated ACPower value.

Usage:
    python calculate_ac_power.py
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
from botocore.exceptions import ClientError
import botocore.config

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('ac_power_calculator')

# Configuration - using exact same pattern as device_status_polling.py
def validate_env_vars():
    """Validate required environment variables"""
    required_vars = ['SOLAR_WEB_ACCESS_KEY_ID', 'SOLAR_WEB_ACCESS_KEY_VALUE', 
                    'SOLAR_WEB_USERID', 'SOLAR_WEB_PASSWORD']
    missing_vars = [var for var in required_vars if not os.environ.get(var)]
    if missing_vars:
        logger.warning(f"Missing environment variables: {missing_vars}. Using defaults.")

validate_env_vars()

# API Configuration - exact same as device_status_polling.py
API_BASE_URL = os.environ.get('API_BASE_URL', 'https://api.solarweb.com/swqapi')
ACCESS_KEY_ID = os.environ.get('SOLAR_WEB_ACCESS_KEY_ID', 'FKIAD151D135048B4C709FFA341FF599BA72')
ACCESS_KEY_VALUE = os.environ.get('SOLAR_WEB_ACCESS_KEY_VALUE', '77619b46-d62d-495d-8a07-aeaa8cf4b228')
USER_ID = os.environ.get('SOLAR_WEB_USERID', 'monitoring@jazzsolar.com')
PASSWORD = os.environ.get('SOLAR_WEB_PASSWORD', 'solar123')

# AWS Configuration - exact same as process_ttn_systems.py
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
DYNAMODB_TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'Moose-DDB')

# Configuration constants
MAX_RETRIES = int(os.environ.get('MAX_RETRIES', '3'))

# Configure DynamoDB with larger connection pool - exact same as device_status_polling.py
dynamodb_config = botocore.config.Config(
    max_pool_connections=50
)
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION, config=dynamodb_config)
table = dynamodb.Table(DYNAMODB_TABLE_NAME)

# JWT token cache - exact same as device_status_polling.py
_jwt_token_cache = {
    'token': None,
    'expires_at': None
}

def get_jwt_token() -> str:
    """Get a JWT token for authentication with the Solar.web API with caching - exact same as device_status_polling.py"""
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
                time.sleep(2 ** attempt)
            else:
                raise
        except Exception as e:
            logger.error(f"Error obtaining JWT token: {str(e)}")
            raise

def api_request(endpoint: str, method: str = 'GET', params: Dict[str, Any] = None) -> Dict[str, Any]:
    """Make an authenticated request to the Solar.web API with retry logic - exact same as device_status_polling.py"""
    if endpoint.startswith('/'):
        endpoint = endpoint[1:]
    
    url = f"{API_BASE_URL}/{endpoint}"
    
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

def query_system_profiles() -> List[Dict[str, Any]]:
    """
    Query DynamoDB for all system profiles where PK begins with "System#" and SK = "PROFILE"
    - exact same pattern as process_ttn_systems.py
    """
    try:
        logger.info("Querying DynamoDB for system profiles...")
        
        # Use scan with filter expression since we need to check all items with PK starting with "System#"
        response = table.scan(
            FilterExpression='begins_with(PK, :pk_prefix) AND SK = :sk_value',
            ExpressionAttributeValues={
                ':pk_prefix': 'System#',
                ':sk_value': 'PROFILE'
            }
        )
        
        items = response.get('Items', [])
        
        # Handle pagination if there are more items
        while 'LastEvaluatedKey' in response:
            logger.info("Fetching more items from DynamoDB...")
            response = table.scan(
                FilterExpression='begins_with(PK, :pk_prefix) AND SK = :sk_value',
                ExpressionAttributeValues={
                    ':pk_prefix': 'System#',
                    ':sk_value': 'PROFILE'
                },
                ExclusiveStartKey=response['LastEvaluatedKey']
            )
            items.extend(response.get('Items', []))
        
        logger.info(f"Found {len(items)} system profile items")
        return items
        
    except ClientError as e:
        logger.error(f"DynamoDB query error: {e}")
        raise
    except Exception as e:
        logger.error(f"Error querying system profiles: {e}")
        raise

def get_system_devices(system_id: str) -> Optional[Dict[str, Any]]:
    """
    Get devices for a system using the Solar.web API
    """
    try:
        endpoint = f'pvsystems/{system_id}/devices'
        logger.info(f"Getting devices for system {system_id}")
        response = api_request(endpoint)
        return response
    except Exception as e:
        logger.error(f"Failed to get devices for system {system_id}: {str(e)}")
        return None

def calculate_total_ac_power(devices: List[Dict[str, Any]]) -> float:
    """
    Calculate total AC power from all inverters in the devices list using nominalAcPower field
    """
    total_power = 0.0
    inverter_count = 0
    
    for device in devices:
        if device.get('deviceType') == 'Inverter':
            device_name = device.get('deviceName', '')
            nominal_ac_power = device.get('nominalAcPower', 0.0)
            
            total_power += nominal_ac_power
            inverter_count += 1
            logger.info(f"Inverter: {device_name} -> nominalAcPower: {nominal_ac_power}")
    
    logger.info(f"Total AC Power from {inverter_count} inverters: {total_power} kW")
    return total_power

def update_system_profile_ac_power(system_id: str, ac_power: float) -> bool:
    """
    Update the system profile in DynamoDB with the calculated AC power
    """
    try:
        # Convert to Decimal for DynamoDB
        ac_power_decimal = Decimal(str(ac_power))
        
        # Update the system profile with AC power
        response = table.update_item(
            Key={
                'PK': f'System#{system_id}',
                'SK': 'PROFILE'
            },
            UpdateExpression='SET ACPower = :ac_power',
            ExpressionAttributeValues={
                ':ac_power': ac_power_decimal
            },
            ReturnValues='UPDATED_NEW'
        )
        
        logger.info(f"Successfully updated system {system_id} with AC Power: {ac_power} kW")
        return True
        
    except ClientError as e:
        logger.error(f"DynamoDB error updating system {system_id}: {e}")
        return False
    except Exception as e:
        logger.error(f"Error updating system {system_id} with AC power: {str(e)}")
        return False

def process_system(system_profile: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process a single system to calculate and update AC power
    """
    system_id = system_profile.get('systemId')
    system_name = system_profile.get('name', f'System {system_id}')
    
    if not system_id:
        logger.error(f"System profile missing systemId: {system_profile}")
        return {'success': False, 'system_id': 'unknown', 'error': 'Missing systemId'}
    
    logger.info(f"Processing system: {system_name} (ID: {system_id})")
    
    try:
        # Get devices for this system
        devices_response = get_system_devices(system_id)
        
        if not devices_response:
            logger.error(f"Failed to get devices for system {system_id}")
            return {'success': False, 'system_id': system_id, 'error': 'Failed to get devices'}
        
        devices = devices_response.get('devices', [])
        if not devices:
            logger.warning(f"No devices found for system {system_id}")
            return {'success': False, 'system_id': system_id, 'error': 'No devices found'}
        
        logger.info(f"Found {len(devices)} devices for system {system_id}")
        
        # Calculate total AC power from inverters
        total_ac_power = calculate_total_ac_power(devices)
        
        if total_ac_power == 0:
            logger.warning(f"No AC power calculated for system {system_id} (no inverters or zero power)")
        
        # Update the system profile with calculated AC power
        if update_system_profile_ac_power(system_id, total_ac_power):
            return {
                'success': True, 
                'system_id': system_id, 
                'ac_power': total_ac_power,
                'device_count': len(devices)
            }
        else:
            return {'success': False, 'system_id': system_id, 'error': 'Failed to update DynamoDB'}
    
    except Exception as e:
        logger.error(f"Error processing system {system_id}: {str(e)}")
        return {'success': False, 'system_id': system_id, 'error': str(e)}

def main():
    """
    Main function to process all system profiles and calculate AC power
    """
    try:
        logger.info("=" * 60)
        logger.info("STARTING AC POWER CALCULATION")
        logger.info("=" * 60)
        
        # Step 1: Query for all system profiles
        system_profiles = query_system_profiles()
        
        if not system_profiles:
            logger.info("No system profiles found. Exiting.")
            return
        
        logger.info(f"Found {len(system_profiles)} system profiles to process")
        
        # Step 2: Process each system
        successful_updates = 0
        failed_updates = 0
        results = []
        
        for system_profile in system_profiles:
            result = process_system(system_profile)
            results.append(result)
            
            if result['success']:
                successful_updates += 1
            else:
                failed_updates += 1
        
        # Step 3: Report results
        logger.info("=" * 60)
        logger.info("AC POWER CALCULATION COMPLETE")
        logger.info("=" * 60)
        logger.info(f"Total systems processed: {len(system_profiles)}")
        logger.info(f"Successfully updated: {successful_updates}")
        logger.info(f"Failed updates: {failed_updates}")
        
        # Show successful updates
        if successful_updates > 0:
            logger.info("\nSuccessful updates:")
            for result in results:
                if result['success']:
                    logger.info(f"  System {result['system_id']}: {result['ac_power']} kW AC Power "
                              f"({result['device_count']} devices)")
        
        # Show failed updates
        if failed_updates > 0:
            logger.info("\nFailed updates:")
            for result in results:
                if not result['success']:
                    logger.info(f"  System {result['system_id']}: {result['error']}")
        
        logger.info("=" * 60)
        print(f"\nFinal Count: {successful_updates} systems updated successfully with AC Power")
        
    except Exception as e:
        logger.error(f"Error in main processing: {e}")
        raise

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logger.info("Process interrupted by user")
    except Exception as e:
        logger.error(f"Script failed: {e}")
        exit(1) 
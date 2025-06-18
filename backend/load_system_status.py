"""
Load System Status Script

This script creates system status entries in DynamoDB by:
1. Getting all PV systems
2. For each system, getting all its inverters
3. Checking each inverter's status from DynamoDB
4. Categorizing inverters by status (green, red, offline)
5. Creating a system status entry with inverter lists
6. Uploading to DynamoDB

Usage:
- As a script: python load_system_status.py
- As AWS Lambda: deploy and configure with appropriate environment variables
"""

import os
import json
import logging
import requests
import boto3
import time
from datetime import datetime, timedelta
from typing import List, Dict, Any
from decimal import Decimal
import botocore.config

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('load_system_status')

# Configuration
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

# Configuration constants
MAX_RETRIES = int(os.environ.get('MAX_RETRIES', '3'))

# Configure DynamoDB with larger connection pool for concurrent operations
dynamodb_config = botocore.config.Config(
    max_pool_connections=50
)
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION, config=dynamodb_config)
table = dynamodb.Table(os.environ.get('DYNAMODB_TABLE_NAME', 'Moose-DDB'))

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
                time.sleep(2 ** attempt)
            else:
                raise
        except Exception as e:
            logger.error(f"Error obtaining JWT token: {str(e)}")
            raise

def api_request(endpoint: str, method: str = 'GET', params: Dict[str, Any] = None) -> Dict[str, Any]:
    """Make an authenticated request to the Solar.web API with retry logic"""
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
    """Get a list of all PV systems from DynamoDB"""
    try:
        # Query for all system profiles (PK begins with "System#" and SK = "PROFILE")
        response = table.scan(
            FilterExpression=boto3.dynamodb.conditions.Attr('PK').begins_with('System#') & 
                           boto3.dynamodb.conditions.Attr('SK').eq('PROFILE')
        )
        
        pv_systems = []
        for item in response.get('Items', []):
            # Extract system ID from PK (remove "System#" prefix)
            system_id = item['PK'].replace('System#', '')
            system_name = item.get('name', item.get('pvSystemName', f'System {system_id}'))
            
            pv_systems.append(PvSystemMetadata(
                pv_system_id=system_id,
                name=system_name
            ))
        
        logger.info(f"Found {len(pv_systems)} PV systems from DynamoDB")
        return pv_systems
        
    except Exception as e:
        logger.error(f"Failed to get PV systems from DynamoDB: {str(e)}")
        return []

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

def get_inverter_status_from_db(device_id: str) -> str:
    """Get inverter status from DynamoDB"""
    try:
        response = table.get_item(
            Key={
                'PK': f'Inverter<{device_id}>',
                'SK': 'STATUS'
            }
        )
        
        if 'Item' in response:
            return response['Item'].get('status', 'green')
        else:
            logger.warning(f"No status found for inverter {device_id}, defaulting to green")
            return 'green'
            
    except Exception as e:
        logger.error(f"Error getting status for inverter {device_id}: {str(e)}")
        return 'green'

def create_system_status_entry(system_id: str, green_inverters: List[str], red_inverters: List[str], offline_inverters: List[str]) -> Dict[str, Any]:
    """Create a system status entry with categorized inverters"""
    current_time = datetime.utcnow().isoformat()
    
    # Determine overall system status based on inverter statuses
    if len(red_inverters) > 0:
        overall_status = "red"
    elif len(offline_inverters) > 0:
        overall_status = "offline"
    else:
        overall_status = "green"
    
    status_entry = {
        "PK": f"System#{system_id}",
        "SK": "STATUS",
        "pvSystemId": system_id,
        "status": overall_status,
        "GreenInverters": green_inverters,
        "RedInverters": red_inverters,
        "OfflineInverters": offline_inverters,
        "TotalInverters": len(green_inverters) + len(red_inverters) + len(offline_inverters),
        "lastUpdated": current_time,
        "createdAt": current_time
    }
    
    return status_entry

def upload_system_status_to_db(status_entry: Dict[str, Any]) -> bool:
    """Upload system status entry to DynamoDB"""
    try:
        # Convert any float values to Decimal for DynamoDB compatibility
        ddb_entry = {}
        for key, value in status_entry.items():
            if isinstance(value, float):
                ddb_entry[key] = Decimal(str(value))
            else:
                ddb_entry[key] = value
        
        table.put_item(Item=ddb_entry)
        logger.info(f"✅ Uploaded system status entry for system {status_entry['pvSystemId']} to DynamoDB")
        return True
        
    except Exception as e:
        logger.error(f"❌ Error uploading system status entry for system {status_entry['pvSystemId']}: {str(e)}")
        return False

def process_system_status(system: PvSystemMetadata) -> bool:
    """Process status for a single system"""
    try:
        logger.info(f"Processing system status for: {system.name} ({system.pv_system_id})")
        
        # Get all devices for this system
        devices = get_system_devices(system.pv_system_id)
        
        if not devices:
            logger.warning(f"No devices found for system {system.pv_system_id}")
            # Create entry with empty lists
            status_entry = create_system_status_entry(system.pv_system_id, [], [], [])
            return upload_system_status_to_db(status_entry)
        
        # Filter for inverters only
        inverters = filter_inverters(devices)
        
        if not inverters:
            logger.warning(f"No inverters found for system {system.pv_system_id}")
            # Create entry with empty lists
            status_entry = create_system_status_entry(system.pv_system_id, [], [], [])
            return upload_system_status_to_db(status_entry)
        
        # Categorize inverters by status
        green_inverters = []
        red_inverters = []
        offline_inverters = []
        
        logger.info(f"Checking status for {len(inverters)} inverters in system {system.pv_system_id}")
        
        for inverter in inverters:
            device_id = inverter.get('deviceId')
            if not device_id:
                logger.warning(f"Inverter missing deviceId: {inverter}")
                continue
            
            status = get_inverter_status_from_db(device_id)
            
            if status == 'green':
                green_inverters.append(device_id)
            elif status == 'red':
                red_inverters.append(device_id)
            elif status == 'offline':
                offline_inverters.append(device_id)
            else:
                logger.warning(f"Unknown status '{status}' for inverter {device_id}, treating as green")
                green_inverters.append(device_id)
        
        logger.info(f"System {system.pv_system_id} status breakdown:")
        logger.info(f"  ✅ Green: {len(green_inverters)} inverters")
        logger.info(f"  🔴 Red: {len(red_inverters)} inverters")
        logger.info(f"  🔌 Offline: {len(offline_inverters)} inverters")
        
        # Create and upload system status entry
        status_entry = create_system_status_entry(
            system.pv_system_id, green_inverters, red_inverters, offline_inverters
        )
        
        # Log overall system status
        overall_status = status_entry['status']
        status_emoji = {"green": "✅", "red": "🔴", "offline": "🔌"}.get(overall_status, "❓")
        logger.info(f"  {status_emoji} Overall System Status: {overall_status.upper()}")
        
        return upload_system_status_to_db(status_entry)
        
    except Exception as e:
        logger.error(f"❌ Error processing system {system.name}: {str(e)}")
        return False

def load_all_system_statuses() -> Dict[str, Any]:
    """Main function to load system statuses for all systems"""
    start_time = time.time()
    
    stats = {
        'systems_processed': 0,
        'systems_uploaded': 0,
        'total_inverters_found': 0,
        'total_green_inverters': 0,
        'total_red_inverters': 0,
        'total_offline_inverters': 0,
        'green_systems': 0,
        'red_systems': 0,
        'offline_systems': 0,
        'errors': 0
    }
    
    try:
        # Fetch JWT token
        logger.info("Fetching JWT token...")
        get_jwt_token()
        
        # Get all PV systems from DynamoDB
        logger.info("Fetching PV systems list from DynamoDB...")
        pv_systems = get_pv_systems()
        
        if not pv_systems:
            logger.warning("No PV systems found")
            return stats
        
        logger.info(f"Found {len(pv_systems)} PV systems. Starting system status processing...")
        
        # Process each system
        for system in pv_systems:
            logger.info(f"\n=== Processing System {stats['systems_processed'] + 1}/{len(pv_systems)}: {system.name} ===")
            
            success = process_system_status(system)
            stats['systems_processed'] += 1
            
            if success:
                stats['systems_uploaded'] += 1
                logger.info(f"✅ Successfully processed system {system.name}")
            else:
                stats['errors'] += 1
                logger.error(f"❌ Failed to process system {system.name}")
        
        # Get final summary by querying what we just created
        logger.info("\n=== Calculating Final Summary ===")
        total_green = 0
        total_red = 0
        total_offline = 0
        green_systems = 0
        red_systems = 0
        offline_systems = 0
        
        for system in pv_systems:
            try:
                response = table.get_item(
                    Key={
                        'PK': f'System#{system.pv_system_id}',
                        'SK': 'STATUS'
                    }
                )
                
                if 'Item' in response:
                    item = response['Item']
                    total_green += len(item.get('GreenInverters', []))
                    total_red += len(item.get('RedInverters', []))
                    total_offline += len(item.get('OfflineInverters', []))
                    
                    # Count system statuses
                    system_status = item.get('status', 'green')
                    if system_status == 'green':
                        green_systems += 1
                    elif system_status == 'red':
                        red_systems += 1
                    elif system_status == 'offline':
                        offline_systems += 1
            except Exception as e:
                logger.error(f"Error reading final status for system {system.pv_system_id}: {str(e)}")
        
        stats['total_green_inverters'] = total_green
        stats['total_red_inverters'] = total_red
        stats['total_offline_inverters'] = total_offline
        stats['total_inverters_found'] = total_green + total_red + total_offline
        stats['green_systems'] = green_systems
        stats['red_systems'] = red_systems
        stats['offline_systems'] = offline_systems
        
        end_time = time.time()
        execution_time = end_time - start_time
        stats['execution_time'] = execution_time
        
        logger.info("=== SYSTEM STATUS LOADING COMPLETED ===")
        logger.info(f"⏱️  Total execution time: {execution_time:.2f} seconds")
        logger.info(f"🏭 Systems processed: {stats['systems_processed']}")
        logger.info(f"☁️  Systems uploaded: {stats['systems_uploaded']}")
        logger.info(f"✅ Green systems: {stats['green_systems']}")
        logger.info(f"🔴 Red systems: {stats['red_systems']}")
        logger.info(f"🔌 Offline systems: {stats['offline_systems']}")
        logger.info(f"⚡ Total inverters found: {stats['total_inverters_found']}")
        logger.info(f"✅ Green inverters: {stats['total_green_inverters']}")
        logger.info(f"🔴 Red inverters: {stats['total_red_inverters']}")
        logger.info(f"🔌 Offline inverters: {stats['total_offline_inverters']}")
        logger.info(f"❌ Errors: {stats['errors']}")
        
        # Print summary
        print(f"\n🏁 SYSTEM STATUS LOADING SUMMARY:")
        print(f"🏭 Systems processed: {stats['systems_processed']}")
        print(f"☁️  Systems uploaded: {stats['systems_uploaded']}")
        print(f"\n📊 SYSTEM STATUS BREAKDOWN:")
        print(f"✅ GREEN Systems: {stats['green_systems']}")
        print(f"🔴 RED Systems: {stats['red_systems']}")
        print(f"🔌 OFFLINE Systems: {stats['offline_systems']}")
        print(f"\n⚡ INVERTER STATUS BREAKDOWN:")
        print(f"Total inverters: {stats['total_inverters_found']}")
        print(f"✅ GREEN: {stats['total_green_inverters']} inverters")
        print(f"🔴 RED: {stats['total_red_inverters']} inverters")
        print(f"🔌 OFFLINE: {stats['total_offline_inverters']} inverters")
        print(f"❌ Errors: {stats['errors']}")
        print("=" * 50)
        
        return stats
        
    except Exception as e:
        logger.error(f"Critical error in system status loading: {str(e)}")
        stats['errors'] += 1
        return stats

def lambda_handler(event, context):
    """AWS Lambda handler function"""
    try:
        result = load_all_system_statuses()
        
        return {
            'statusCode': 200,
            'body': json.dumps(result)
        }
    except Exception as e:
        logger.error(f"Lambda execution failed: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': str(e),
                'message': 'System status loading execution failed'
            })
        }

if __name__ == "__main__":
    result = load_all_system_statuses()
    print(json.dumps(result, indent=2)) 
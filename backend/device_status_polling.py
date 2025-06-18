"""
Solar Device Status Polling Script

This script polls the Solar.web API to check device status, current power,
and error conditions for all inverters. It updates DynamoDB when status changes
and sends SNS notifications for status changes.

Key Features:
- Monitors individual inverters instead of systems
- Uses device-specific endpoints for flowdata and messages
- Simplified status logic: offline/green/red based on connectivity, power, and errors
- Updates DynamoDB only when status changes
- Sends SNS notifications for status changes

Usage:
- As a script: python device_status_polling.py
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
from concurrent.futures import ThreadPoolExecutor, as_completed
from decimal import Decimal
import threading
import botocore.config

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('device_status_polling')

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

# Supabase Configuration
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://vemtgbvseyegqxychrzm.supabase.co')
SUPABASE_ANON_KEY = os.environ.get('SUPABASE_ANON_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlbXRnYnZzZXllZ3F4eWNocnptIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDYwMTY1ODMsImV4cCI6MjA2MTU5MjU4M30.T8SFfZ2Ai1O77eNRQnKWk-_I9tePCjflJ4utGZKuBq4')

# AWS Configuration
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
SNS_TOPIC_ARN = os.environ.get('SNS_TOPIC_ARN', 'arn:aws:sns:us-east-1:381492109487:solarSystemAlerts')

# Configuration constants
MAX_RETRIES = int(os.environ.get('MAX_RETRIES', '3'))

# Initialize AWS clients
sns = boto3.client('sns', region_name=AWS_REGION)

# Configure DynamoDB with larger connection pool for concurrent operations
dynamodb_config = botocore.config.Config(
    max_pool_connections=50  # Increase from default 10 to handle concurrent threads
)
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION, config=dynamodb_config)
table = dynamodb.Table(os.environ.get('DYNAMODB_TABLE_NAME', 'Moose-DDB'))

# JWT token cache
_jwt_token_cache = {
    'token': None,
    'expires_at': None
}

# Error codes cache
_error_codes_cache = {
    'codes': None,
    'expires_at': None
}

# Thread lock for stats
stats_lock = threading.Lock()

class InverterMetadata:
    def __init__(self, pv_system_id: str, device_id: str, system_name: str = None):
        self.pv_system_id = pv_system_id
        self.device_id = device_id
        self.system_name = system_name or f"System {pv_system_id}"

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

def get_all_error_codes_from_supabase() -> Dict[int, str]:
    """Get all error codes and their colors from Supabase with caching"""
    global _error_codes_cache
    
    # Check if we have a valid cached response
    if (_error_codes_cache['codes'] and _error_codes_cache['expires_at'] and 
        datetime.utcnow() < _error_codes_cache['expires_at']):
        logger.debug("Using cached error codes")
        return _error_codes_cache['codes']
    
    try:
        url = f"{SUPABASE_URL}/rest/v1/error_codes"
        headers = {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': f'Bearer {SUPABASE_ANON_KEY}',
            'Content-Type': 'application/json'
        }
        
        params = {
            'select': 'code,colour'
        }
        
        response = requests.get(url, headers=headers, params=params, timeout=30)
        response.raise_for_status()
        
        data = response.json()
        
        color_map = {}
        for item in data:
            if 'code' in item and 'colour' in item:
                color_map[item['code']] = item['colour']
        
        # Cache the results for 1 hour
        _error_codes_cache['codes'] = color_map
        _error_codes_cache['expires_at'] = datetime.utcnow() + timedelta(hours=1)
        
        logger.info(f"Retrieved and cached {len(color_map)} error codes from Supabase")
        return color_map
        
    except Exception as e:
        logger.error(f"Error fetching all error codes from Supabase: {str(e)}")
        return {}

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

def get_all_inverters() -> List[InverterMetadata]:
    """Get all inverters from DynamoDB"""
    try:
        # Query for all inverter status records (PK begins with "Inverter<" and SK = "STATUS")
        response = table.scan(
            FilterExpression=boto3.dynamodb.conditions.Attr('PK').begins_with('Inverter<') & 
                           boto3.dynamodb.conditions.Attr('SK').eq('STATUS')
        )
        
        inverters = []
        for item in response.get('Items', []):
            # Extract device ID from PK (remove "Inverter<" prefix and ">" suffix)
            device_id = item['PK'].replace('Inverter<', '').replace('>', '')
            pv_system_id = item.get('pvSystemId', '')
            
            if device_id and pv_system_id:
                inverters.append(InverterMetadata(
                    pv_system_id=pv_system_id,
                    device_id=device_id
                ))
        
        logger.info(f"Found {len(inverters)} inverters from DynamoDB")
        return inverters
        
    except Exception as e:
        logger.error(f"Failed to get inverters from DynamoDB: {str(e)}")
        return []

def get_device_flowdata(pv_system_id: str, device_id: str) -> Dict[str, Any]:
    """Get current power and online status for a device"""
    try:
        endpoint = f'pvsystems/{pv_system_id}/devices/{device_id}/flowdata'
        response = api_request(endpoint)
        return response
    except Exception as e:
        logger.error(f"Failed to get flowdata for device {device_id} in system {pv_system_id}: {str(e)}")
        return {}

def get_device_messages(pv_system_id: str, device_id: str, from_timestamp: str) -> Dict[str, Any]:
    """Get error messages for a device from a specific timestamp"""
    try:
        endpoint = f'pvsystems/{pv_system_id}/devices/{device_id}/messages'
        params = {
            'from': from_timestamp,
            'statetype': 'Error',
            'stateseverity': 'Error'
        }
        response = api_request(endpoint, params=params)
        return response
    except Exception as e:
        logger.error(f"Failed to get messages for device {device_id} in system {pv_system_id}: {str(e)}")
        return {}

def get_device_status_from_db(device_id: str) -> Dict[str, Any]:
    """Get existing device status from DynamoDB"""
    try:
        response = table.get_item(
            Key={
                'PK': f'Inverter<{device_id}>',
                'SK': 'STATUS'
            }
        )
        
        if 'Item' in response:
            return response['Item']
        else:
            return {
                'status': 'green',
                'lastUpdated': None,
                'lastStatusChangeTime': None,
                'power': 0
            }
            
    except Exception as e:
        logger.error(f"Error getting device status for {device_id}: {str(e)}")
        return {
            'status': 'green',
            'lastUpdated': None,
            'lastStatusChangeTime': None,
            'power': 0
        }

def update_device_status_in_db(device_id: str, pv_system_id: str, status: str, power: float) -> bool:
    """Update device status in DynamoDB"""
    try:
        now = datetime.utcnow().isoformat()
        
        status_item = {
            'PK': f'Inverter<{device_id}>',
            'SK': 'STATUS',
            'pvSystemId': pv_system_id,
            'device_id': device_id,
            'status': status,
            'power': Decimal(str(power)),  # Convert float to Decimal for DynamoDB
            'lastStatusChangeTime': now,
            'lastUpdated': now
        }
        
        table.put_item(Item=status_item)
        logger.info(f"✅ Updated status for device {device_id} to {status}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Error updating status for device {device_id}: {str(e)}")
        return False

def send_device_status_change_sns(device_id: str, pv_system_id: str, new_status: str, previous_status: str, power: float) -> bool:
    """Send SNS message for device status change"""
    try:
        message = {
            "deviceId": device_id,
            "pvSystemId": pv_system_id,
            "newStatus": new_status,
            "previousStatus": previous_status,
            "timestamp": datetime.utcnow().isoformat(),
            "power": power
        }
        
        response = sns.publish(
            TopicArn=SNS_TOPIC_ARN,
            Subject=f"Solar Inverter Status Change - {device_id}",
            Message=json.dumps(message),
            MessageAttributes={
                'source': {
                    'DataType': 'String',
                    'StringValue': 'device-status-polling-script'
                },
                'deviceId': {
                    'DataType': 'String',
                    'StringValue': device_id
                },
                'systemId': {
                    'DataType': 'String',
                    'StringValue': pv_system_id
                },
                'statusChange': {
                    'DataType': 'String',
                    'StringValue': f'{previous_status}-{new_status}'
                }
            }
        )
        
        logger.info(f"✅ Sent SNS status change notification for device {device_id}: {previous_status} → {new_status}. Message ID: {response['MessageId']}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Error sending SNS message for device {device_id}: {str(e)}")
        return False

def process_device_status(inverter: InverterMetadata, target_date: datetime, stats: Dict[str, int]) -> bool:
    """Process status for a single inverter device - Simplified Logic"""
    try:
        logger.info(f"Processing status for device: {inverter.device_id} (System: {inverter.pv_system_id})")
        
        # Get current device status from DynamoDB
        current_status_data = get_device_status_from_db(inverter.device_id)
        current_status = current_status_data.get('status', 'green')
        last_updated = current_status_data.get('lastUpdated')
        
        # Get flowdata to check online status and power
        flowdata = get_device_flowdata(inverter.pv_system_id, inverter.device_id)
        
        # Handle null/empty flowdata (device is considered offline)
        if not flowdata:
            new_status = 'offline'
            power = 0.0
            logger.info(f"Device {inverter.device_id} is offline - no flowdata received")
            print(f"🔌 Device {inverter.device_id}: status is OFFLINE because no flowdata received")
        else:
            # Check if device is online (with null-safe access)
            status_data = flowdata.get('status') if flowdata else None
            is_online = status_data.get('isOnline', False) if status_data else False
            
            if not is_online:
                # Device is offline
                new_status = 'offline'
                power = 0.0
                logger.info(f"Device {inverter.device_id} is offline - isOnline is false")
                print(f"🔌 Device {inverter.device_id}: status is OFFLINE because device is not reachable")
            else:
                # Device is online, get power (with null-safe access)
                power = 0.0
                data_section = flowdata.get('data') if flowdata else None
                channels = data_section.get('channels', []) if data_section else []
                
                for channel in channels:
                    if channel.get('channelName') == 'PowerPV' and channel.get('value') is not None:
                        power = float(channel['value'])
                        break
                
                logger.info(f"Device {inverter.device_id} is online with power: {power}W")
                
                # Determine the timestamp to check messages from
                if last_updated:
                    # Convert ISO timestamp to Fronius API format (yyyyMMddTHHmmssTZD)
                    try:
                        # Parse the ISO timestamp
                        dt = datetime.fromisoformat(last_updated.replace('Z', '+00:00'))
                        # Convert to Fronius API format
                        from_timestamp = dt.strftime("%Y%m%dT%H%M%S") + "Z"
                        logger.debug(f"Checking messages for device {inverter.device_id} since last update: {last_updated} -> {from_timestamp}")
                    except Exception as e:
                        logger.warning(f"Error parsing lastUpdated timestamp {last_updated} for device {inverter.device_id}: {e}. Using today instead.")
                        from_timestamp = target_date.strftime("%Y%m%dT%H%M%S") + "Z"
                else:
                    # No previous update, check from today in Fronius API format
                    from_timestamp = target_date.strftime("%Y%m%dT%H%M%S") + "Z"
                    logger.debug(f"No previous update for device {inverter.device_id}, checking messages from today: {from_timestamp}")
                
                # Get error messages since last update
                messages_response = get_device_messages(inverter.pv_system_id, inverter.device_id, from_timestamp)
                
                # Check for red error messages
                has_red_errors = False
                if messages_response and 'messages' in messages_response and messages_response['messages']:
                    # Pre-load error codes
                    error_codes = [msg['stateCode'] for msg in messages_response['messages']]
                    color_map = get_all_error_codes_from_supabase()
                    
                    # Check if any new errors are red
                    for msg in messages_response['messages']:
                        error_code = msg['stateCode']
                        if color_map.get(error_code) == 'red':
                            has_red_errors = True
                            logger.info(f"Found new red error {error_code} for device {inverter.device_id} at {msg.get('logDateTime', 'unknown time')}")
                            break
                
                # Simplified Status Logic
                if has_red_errors or current_status == 'red':
                    # There are new red errors OR current status is red
                    if power > 0:
                        # Power is above 0 - set status to green (red errors cleared)
                        new_status = 'green'
                        print(f"✅ Device {inverter.device_id}: status is GREEN because power > 0 ({power}W) - red errors cleared")
                    else:
                        # Power is 0 or less - set/keep status as red
                        new_status = 'red'
                        print(f"🔴 Device {inverter.device_id}: status is RED because power ≤ 0 ({power}W) with red errors")
                else:
                    # No new red errors and current status is not red
                    if current_status == 'offline' and power == 0:
                        # Keep as offline if previously offline and still no power
                        new_status = 'offline'
                        print(f"🔌 Device {inverter.device_id}: status remains OFFLINE because online but no power ({power}W)")
                    else:
                        new_status = 'green'
                        print(f"✅ Device {inverter.device_id}: status is GREEN because no new red errors")
        
        # Update status counters
        if new_status == 'green':
            update_stats_thread_safe(stats, 'green_devices')
        elif new_status == 'red':
            update_stats_thread_safe(stats, 'red_devices')
        elif new_status == 'offline':
            update_stats_thread_safe(stats, 'offline_devices')
        
        # Check if status changed
        if new_status != current_status:
            # Update DynamoDB
            update_success = update_device_status_in_db(
                inverter.device_id, inverter.pv_system_id, new_status, power
            )
            
            if update_success:
                # Send SNS notification
                sns_success = send_device_status_change_sns(
                    inverter.device_id, inverter.pv_system_id, new_status, current_status, power
                )
                
                if sns_success:
                    update_stats_thread_safe(stats, 'status_changes')
                    logger.info(f"✅ Status change processed for device {inverter.device_id}: {current_status} → {new_status}")
                
                return sns_success
            else:
                return False
        else:
            # No status change, but still update lastUpdated timestamp
            update_device_status_in_db(inverter.device_id, inverter.pv_system_id, new_status, power)
            logger.info(f"No status change for device {inverter.device_id} (remains {current_status})")
            return True
        
    except Exception as e:
        logger.error(f"❌ Error processing device {inverter.device_id}: {str(e)}")
        return False

def update_stats_thread_safe(stats, key, increment=1):
    """Thread-safe stats update"""
    with stats_lock:
        stats[key] += increment

def process_devices_concurrently():
    """Main function to process all devices for status"""
    start_time = time.time()
    utc_now = datetime.utcnow()
    today = utc_now - timedelta(hours=5)  # EST timezone
    
    stats = {
        'devices_processed': 0,
        'status_changes': 0,
        'errors': 0,
        'api_calls_made': 0,
        'green_devices': 0,
        'red_devices': 0,
        'offline_devices': 0
    }
    
    try:
        # Fetch JWT token
        logger.info("Fetching JWT token...")
        get_jwt_token()
        
        # Pre-load all error codes from Supabase for efficiency
        logger.info("Pre-loading error codes from Supabase...")
        error_codes_loaded = get_all_error_codes_from_supabase()
        logger.info(f"Pre-loaded {len(error_codes_loaded)} error codes for efficient lookup")
        
        # Get all inverters from DynamoDB
        logger.info("Fetching inverters list from DynamoDB...")
        inverters = get_all_inverters()
        
        if not inverters:
            logger.warning("No inverters found")
            return stats
        
        logger.info(f"Found {len(inverters)} inverters. Starting status processing...")
        
        # Process devices in batches
        batch_size = 32
        total_batches = (len(inverters) + batch_size - 1) // batch_size
        
        for batch_num in range(total_batches):
            start_idx = batch_num * batch_size
            end_idx = min(start_idx + batch_size, len(inverters))
            batch_inverters = inverters[start_idx:end_idx]
            
            logger.info(f"Processing batch {batch_num + 1}/{total_batches}: devices {start_idx + 1}-{end_idx}")
            
            with ThreadPoolExecutor(max_workers=batch_size) as executor:
                future_to_inverter = {
                    executor.submit(process_device_status, inverter, today, stats): inverter 
                    for inverter in batch_inverters
                }
                
                for future in as_completed(future_to_inverter):
                    inverter = future_to_inverter[future]
                    try:
                        success = future.result()
                        
                        update_stats_thread_safe(stats, 'devices_processed')
                        update_stats_thread_safe(stats, 'api_calls_made', 2)  # flowdata + messages
                        
                        if not success:
                            update_stats_thread_safe(stats, 'errors')
                        
                    except Exception as e:
                        logger.error(f"❌ Error processing device {inverter.device_id}: {str(e)}")
                        update_stats_thread_safe(stats, 'errors')
            
            if batch_num < total_batches - 1:
                logger.info(f"Batch {batch_num + 1} completed. Waiting 0.5 seconds before next batch...")
                time.sleep(0.5)
        
        end_time = time.time()
        execution_time = end_time - start_time
        stats['execution_time'] = execution_time
        
        logger.info("=== DEVICE STATUS POLLING COMPLETED ===")
        logger.info(f"⏱️  Total execution time: {execution_time:.2f} seconds")
        logger.info(f"🔧 Devices processed: {stats['devices_processed']}")
        logger.info(f"🔄 Status changes: {stats['status_changes']}")
        logger.info(f"🌐 Total API calls made: {stats['api_calls_made']}")
        logger.info(f"✅ Green devices: {stats['green_devices']}")
        logger.info(f"🔴 Red devices: {stats['red_devices']}")
        logger.info(f"🔌 Offline devices: {stats['offline_devices']}")
        logger.info(f"❌ Errors: {stats['errors']}")
        
        # Print summary counts
        print(f"\n🏁 FINAL DEVICE STATUS SUMMARY:")
        print(f"✅ GREEN: {stats['green_devices']} devices")
        print(f"🔴 RED: {stats['red_devices']} devices") 
        print(f"🔌 OFFLINE: {stats['offline_devices']} devices")
        print(f"📊 Total: {stats['green_devices'] + stats['red_devices'] + stats['offline_devices']} devices")
        print(f"🔄 Status changes: {stats['status_changes']}")
        print("=" * 50)
        
        return stats
        
    except Exception as e:
        logger.error(f"Critical error in device status processing: {str(e)}")
        stats['errors'] += 1
        return stats

def main():
    """Main entry point"""
    try:
        result = process_devices_concurrently()
        return result
        
    except Exception as e:
        logger.error(f"Error in main execution: {str(e)}")
        raise

def lambda_handler(event, context):
    """AWS Lambda handler function"""
    try:
        result = process_devices_concurrently()
        
        return {
            'statusCode': 200,
            'body': json.dumps(result)
        }
    except Exception as e:
        logger.error(f"Lambda execution failed: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }

if __name__ == "__main__":
    main() 
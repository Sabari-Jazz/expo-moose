"""
Solar Status Polling Script

This script polls the Solar.web API to check system status, current power,
and error conditions for all PV systems. It updates DynamoDB when status changes
and sends SNS notifications for status changes.

Key Features:
- Polls current power and online status via flowdata API
- Checks today's error messages for red errors
- Determines system status based on power and error conditions
- Updates DynamoDB only when status changes
- Sends SNS notifications for status changes

Usage:
- As a script: python status_polling.py
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
logger = logging.getLogger('status_polling')

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
ACCESS_KEY_ID = os.environ.get('SOLAR_WEB_ACCESS_KEY_ID', 'FKIA08F3E94E3D064B629EE82A44C8D1D0A6')
ACCESS_KEY_VALUE = os.environ.get('SOLAR_WEB_ACCESS_KEY_VALUE', '2f62d6f2-77e6-4796-9fd1-5d74b5c6474c')
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

# Thread lock for stats
stats_lock = threading.Lock()

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
    """Get a list of all PV systems"""
    try:
        response = api_request('pvsystems?offset=0&limit=100')
        
        if not response or 'pvSystems' not in response:
            logger.warning("No PV systems found in the response")
            return []
        
        pv_systems = []
        for system in response['pvSystems']:
            if 'pvSystemId' in system and 'name' in system:
                pv_systems.append(PvSystemMetadata(
                    pv_system_id=system['pvSystemId'],
                    name=system['name']
                ))
        
        logger.info(f"Found {len(pv_systems)} PV systems")
        return pv_systems
        
    except Exception as e:
        logger.error(f"Failed to get PV systems: {str(e)}")
        return []

def get_system_flowdata(system_id: str) -> Dict[str, Any]:
    """Get current power and online status for a system"""
    try:
        response = api_request(f'pvsystems/{system_id}/flowdata')
        return response
    except Exception as e:
        logger.error(f"Failed to get flowdata for system {system_id}: {str(e)}")
        return {}

def get_error_code_colors_from_supabase(error_codes: List[int]) -> Dict[int, str]:
    """Get error code colors from Supabase"""
    if not error_codes:
        return {}
    
    try:
        url = f"{SUPABASE_URL}/rest/v1/error_codes"
        headers = {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': f'Bearer {SUPABASE_ANON_KEY}',
            'Content-Type': 'application/json'
        }
        
        params = {
            'code': f'in.({",".join(map(str, error_codes))})',
            'select': 'code,colour'
        }
        
        response = requests.get(url, headers=headers, params=params, timeout=30)
        response.raise_for_status()
        
        data = response.json()
        
        color_map = {}
        for item in data:
            if 'code' in item and 'colour' in item:
                color_map[item['code']] = item['colour']
        
        logger.info(f"Retrieved colors for {len(color_map)} error codes from Supabase")
        return color_map
        
    except Exception as e:
        logger.error(f"Error fetching error codes from Supabase: {str(e)}")
        return {}

def get_system_status_from_db(system_id: str) -> Dict[str, Any]:
    """Get existing system status from DynamoDB"""
    try:
        response = table.get_item(
            Key={
                'PK': f'System#{system_id}',
                'SK': 'STATUS'
            }
        )
        
        if 'Item' in response:
            return response['Item']
        else:
            return {
                'status': 'green',
                'lastRedErrorResolvedTime': None,
                'lastStatusChangeTime': None,
                'power': 0
            }
            
    except Exception as e:
        logger.error(f"Error getting system status for {system_id}: {str(e)}")
        return {
            'status': 'green',
            'lastRedErrorResolvedTime': None,
            'lastStatusChangeTime': None,
            'power': 0
        }

def update_system_status_in_db(system_id: str, status: str, power: float, last_red_error_resolved_time: str = None) -> bool:
    """Update system status in DynamoDB"""
    try:
        now = datetime.utcnow().isoformat()
        
        status_item = {
            'PK': f'System#{system_id}',
            'SK': 'STATUS',
            'pvSystemId': system_id,
            'status': status,
            'power': Decimal(str(power)),  # Convert float to Decimal for DynamoDB
            'lastStatusChangeTime': now,
            'lastUpdated': now
        }
        
        if last_red_error_resolved_time:
            status_item['lastRedErrorResolvedTime'] = last_red_error_resolved_time
        
        table.put_item(Item=status_item)
        logger.info(f"✅ Updated status for system {system_id} to {status}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Error updating status for system {system_id}: {str(e)}")
        return False

def send_status_change_sns(system_id: str, new_status: str, previous_status: str, power: float) -> bool:
    """Send SNS message for status change"""
    try:
        message = {
            "pvSystemId": system_id,
            "newStatus": new_status,
            "previousStatus": previous_status,
            "timestamp": datetime.utcnow().isoformat(),
            "power": power
        }
        
        response = sns.publish(
            TopicArn=SNS_TOPIC_ARN,
            Subject=f"Solar System Status Change - {system_id}",
            Message=json.dumps(message),
            MessageAttributes={
                'source': {
                    'DataType': 'String',
                    'StringValue': 'status-polling-script'
                },
                'systemId': {
                    'DataType': 'String',
                    'StringValue': system_id
                },
                'statusChange': {
                    'DataType': 'String',
                    'StringValue': f'{previous_status}-{new_status}'
                }
            }
        )
        
        logger.info(f"✅ Sent SNS status change notification for {system_id}: {previous_status} → {new_status}. Message ID: {response['MessageId']}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Error sending SNS message for system {system_id}: {str(e)}")
        return False

def process_system_status(system: PvSystemMetadata, target_date: datetime, stats: Dict[str, int]) -> bool:
    """Process status for a single system"""
    try:
        logger.info(f"Processing status for system: {system.name} ({system.pv_system_id})")
        
        # Get current system status from DynamoDB
        current_status_data = get_system_status_from_db(system.pv_system_id)
        current_status = current_status_data.get('status', 'green')
        last_resolved_time = current_status_data.get('lastRedErrorResolvedTime')
        
        # Get flowdata to check online status and power
        flowdata = get_system_flowdata(system.pv_system_id)
        
        if not flowdata:
            logger.warning(f"No flowdata received for {system.name}")
            return False
        
        # Check if system is online
        is_online = flowdata.get('status', {}).get('isOnline', False)
        
        if not is_online:
            # System is offline - preserve existing resolved time
            new_status = 'offline'
            power = 0.0
            logger.info(f"System {system.name} is offline")
            print(f"🔌 {system.name}: status is OFFLINE because system is not reachable")
        else:
            # System is online, get power
            power = 0.0
            channels = flowdata.get('data', {}).get('channels', [])
            for channel in channels:
                if channel.get('channelName') == 'PowerPV' and channel.get('value') is not None:
                    power = float(channel['value'])
                    break
            
            logger.info(f"System {system.name} is online with power: {power}W")
            
            # Get today's error messages
            params = {
                'from': target_date.strftime("%Y%m%dT000000"),
                'statetype': 'Error',
                'stateseverity': 'Error'
            }
            
            messages_response = api_request(f"pvsystems/{system.pv_system_id}/messages", params=params)
            
            if not messages_response or 'messages' not in messages_response or not messages_response['messages']:
                # No error messages - determine status based on current state and power
                new_status = 'green' if current_status != 'red' or power > 0 else 'red'
                if new_status == 'green':
                    print(f"✅ {system.name}: status is GREEN because no error messages found")
                else:
                    print(f"🔴 {system.name}: status is RED because previously red with no power ({power}W)")
            else:
                # Process error messages
                error_codes = [msg['stateCode'] for msg in messages_response['messages']]
                
                # Get error colors from Supabase
                color_map = get_error_code_colors_from_supabase(error_codes)
                
                # Filter red errors after last resolved time
                red_errors = []
                for msg in messages_response['messages']:
                    error_code = msg['stateCode']
                    if color_map.get(error_code) == 'red':
                        error_time = msg['logDateTime']
                        # Check if this error is after last resolved time
                        if not last_resolved_time or error_time > last_resolved_time:
                            red_errors.append(msg)
                
                if red_errors:
                    # Unresolved red errors exist
                    if power > 0:
                        # Recovery detected - update resolved time
                        new_status = 'green'
                        last_resolved_time = max(msg['logDateTime'] for msg in messages_response['messages'] 
                                               if color_map.get(msg['stateCode']) == 'red')
                        print(f"✅ {system.name}: status is GREEN because recovery detected (red errors but producing {power}W)")
                    else:
                        # Red errors + no power
                        new_status = 'red'
                        print(f"🔴 {system.name}: status is RED because unresolved red errors with no power ({power}W)")
                else:
                    # No unresolved red errors - determine status based on current state and power
                    new_status = 'green' if current_status != 'red' or power > 0 else 'red'
                    if new_status == 'green':
                        print(f"✅ {system.name}: status is GREEN because no unresolved red errors")
                    else:
                        print(f"🔴 {system.name}: status is RED because previously red with no power ({power}W)")
        
        # Update status counters
        if new_status == 'green':
            update_stats_thread_safe(stats, 'green_systems')
        elif new_status == 'red':
            update_stats_thread_safe(stats, 'red_systems')
        elif new_status == 'offline':
            update_stats_thread_safe(stats, 'offline_systems')
        
        # Check if status changed
        if new_status != current_status:
            # Update DynamoDB
            update_success = update_system_status_in_db(
                system.pv_system_id, new_status, power, last_resolved_time
            )
            
            if update_success:
                # Send SNS notification
                sns_success = send_status_change_sns(
                    system.pv_system_id, new_status, current_status, power
                )
                
                if sns_success:
                    update_stats_thread_safe(stats, 'status_changes')
                    logger.info(f"✅ Status change processed for {system.name}: {current_status} → {new_status}")
                
                return sns_success
            else:
                return False
        else:
            logger.info(f"No status change for {system.name} (remains {current_status})")
            return True
        
    except Exception as e:
        logger.error(f"❌ Error processing system {system.name}: {str(e)}")
        return False

def update_stats_thread_safe(stats, key, increment=1):
    """Thread-safe stats update"""
    with stats_lock:
        stats[key] += increment

def process_systems_concurrently():
    """Main function to process all systems for status"""
    start_time = time.time()
    utc_now = datetime.utcnow()
    today = utc_now - timedelta(hours=5)  # EST timezone
    
    stats = {
        'systems_processed': 0,
        'status_changes': 0,
        'errors': 0,
        'api_calls_made': 0,
        'green_systems': 0,
        'red_systems': 0,
        'offline_systems': 0
    }
    
    try:
        # Fetch JWT token
        logger.info("Fetching JWT token...")
        get_jwt_token()
        
        # Get all PV systems
        logger.info("Fetching PV systems list...")
        pv_systems = get_pv_systems()
        
        if not pv_systems:
            logger.warning("No PV systems found")
            return stats
        
        logger.info(f"Found {len(pv_systems)} PV systems. Starting status processing...")
        
        # Process systems in batches
        batch_size = 32
        total_batches = (len(pv_systems) + batch_size - 1) // batch_size
        
        for batch_num in range(total_batches):
            start_idx = batch_num * batch_size
            end_idx = min(start_idx + batch_size, len(pv_systems))
            batch_systems = pv_systems[start_idx:end_idx]
            
            logger.info(f"Processing batch {batch_num + 1}/{total_batches}: systems {start_idx + 1}-{end_idx}")
            
            with ThreadPoolExecutor(max_workers=batch_size) as executor:
                future_to_system = {
                    executor.submit(process_system_status, system, today, stats): system 
                    for system in batch_systems
                }
                
                for future in as_completed(future_to_system):
                    system = future_to_system[future]
                    try:
                        success = future.result()
                        
                        update_stats_thread_safe(stats, 'systems_processed')
                        update_stats_thread_safe(stats, 'api_calls_made', 2)  # flowdata + messages
                        
                        if not success:
                            update_stats_thread_safe(stats, 'errors')
                        
                    except Exception as e:
                        logger.error(f"❌ Error processing system {system.name}: {str(e)}")
                        update_stats_thread_safe(stats, 'errors')
            
            if batch_num < total_batches - 1:
                logger.info(f"Batch {batch_num + 1} completed. Waiting 0.5 seconds before next batch...")
                time.sleep(0.5)
        
        end_time = time.time()
        execution_time = end_time - start_time
        stats['execution_time'] = execution_time
        
        logger.info("=== STATUS POLLING COMPLETED ===")
        logger.info(f"⏱️  Total execution time: {execution_time:.2f} seconds")
        logger.info(f"🏭 Systems processed: {stats['systems_processed']}")
        logger.info(f"🔄 Status changes: {stats['status_changes']}")
        logger.info(f"🌐 Total API calls made: {stats['api_calls_made']}")
        logger.info(f"✅ Green systems: {stats['green_systems']}")
        logger.info(f"🔴 Red systems: {stats['red_systems']}")
        logger.info(f"🔌 Offline systems: {stats['offline_systems']}")
        logger.info(f"❌ Errors: {stats['errors']}")
        
        # Print summary counts
        print(f"\n🏁 FINAL STATUS SUMMARY:")
        print(f"✅ GREEN: {stats['green_systems']} systems")
        print(f"🔴 RED: {stats['red_systems']} systems") 
        print(f"🔌 OFFLINE: {stats['offline_systems']} systems")
        print(f"📊 Total: {stats['green_systems'] + stats['red_systems'] + stats['offline_systems']} systems")
        print(f"🔄 Status changes: {stats['status_changes']}")
        print("=" * 50)
        
        return stats
        
    except Exception as e:
        logger.error(f"Critical error in status processing: {str(e)}")
        stats['errors'] += 1
        return stats

def lambda_handler(event, context):
    """AWS Lambda handler function"""
    try:
        result = process_systems_concurrently()
        
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
                'message': 'Status polling execution failed'
            })
        }

if __name__ == "__main__":
    result = process_systems_concurrently()
    print(json.dumps(result, indent=2)) 
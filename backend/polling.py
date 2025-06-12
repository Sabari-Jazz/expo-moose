"""
Solar Data Polling Script - SIMPLIFIED VERSION

This script polls the Solar.web API to collect comprehensive data for all PV systems
and stores it in consolidated DynamoDB entries. Each time period gets its own function.

Key Features:
- Simple, clear logic with separate functions for each time period
- Daily: 2 API calls (aggr + flow), Weekly/Monthly/Yearly: 1 API call each (aggr only)
- Batch processing of 8 systems with 3-second delays
- Direct storage to DynamoDB from each function

Usage:
- As a script: python polling.py
- As AWS Lambda: deploy and configure with appropriate environment variables
"""

import os
import json
import logging
import requests
import boto3
import time
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Union
from botocore.exceptions import ClientError
from decimal import Decimal
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('polling')

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
ACCESS_KEY_ID = os.environ.get('SOLAR_WEB_ACCESS_KEY_ID', 'FKIA08F3E94E3D064B629EE82A44C8D1D0A6')
ACCESS_KEY_VALUE = os.environ.get('SOLAR_WEB_ACCESS_KEY_VALUE', '2f62d6f2-77e6-4796-9fd1-5d74b5c6474c')
USER_ID = os.environ.get('SOLAR_WEB_USERID', 'monitoring@jazzsolar.com')
PASSWORD = os.environ.get('SOLAR_WEB_PASSWORD', 'solar123')

# AWS Configuration
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
DYNAMODB_TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'Moose-DDB')

# Configuration constants
MAX_RETRIES = int(os.environ.get('MAX_RETRIES', '3'))
EARNINGS_RATE_PER_KWH = 0.40  # $0.40 per kWh

# Initialize DynamoDB client
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
table = dynamodb.Table(DYNAMODB_TABLE_NAME)

# Initialize SNS client
sns = boto3.client('sns', region_name=AWS_REGION)

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
        
        pv_systems = []
        for system in response['pvSystems']:
            if 'pvSystemId' in system and 'name' in system:
                pv_systems.append(PvSystemMetadata(
                    pv_system_id=system['pvSystemId'],
                    name=system['name']
                ))
            else:
                logger.warning(f"Invalid system data: {system}")
        
        logger.info(f"Found {len(pv_systems)} PV systems")
        return pv_systems
        
    except Exception as e:
        logger.error(f"Failed to get PV systems: {str(e)}")
        return []

def find_channel_value(api_response, channel_name):
    """Extract channel value from API response"""
    if not api_response:
        return 0
    
    try:
        # Handle aggregated data response
        if 'data' in api_response and isinstance(api_response['data'], list):
            for item in api_response['data']:
                if 'channels' in item:
                    for channel in item['channels']:
                        if channel.get('channelName') == channel_name:
                            return float(channel['value']) if channel.get('value') is not None else 0
        
        # Handle flow data response (check if data is not None before accessing channels)
        elif 'data' in api_response and api_response['data'] is not None and 'channels' in api_response['data']:
            for channel in api_response['data']['channels']:
                if channel.get('channelName') == channel_name:
                    return float(channel['value']) if channel.get('value') is not None else 0
        
    except Exception as e:
        logger.error(f"Error extracting channel value for {channel_name}: {str(e)}")
    
    return 0

def get_first_day_of_week(date: datetime) -> datetime:
    """Get Monday of the week containing the given date"""
    return date - timedelta(days=date.weekday())

def get_first_day_of_month(date: datetime) -> datetime:
    """Get first day of the month containing the given date"""
    return date.replace(day=1)

def get_first_day_of_year(date: datetime) -> datetime:
    """Get first day of the year containing the given date"""
    return date.replace(month=1, day=1)

def store_daily_data(system: PvSystemMetadata, target_date: datetime) -> bool:
    """Store daily data - makes 2 API calls (aggr + flow)"""
    try:
        logger.info(f"Storing daily data for {system.name}")
        
        # API call 1: Get energy and CO2 from aggregated data
        aggr_params = {
            'from': target_date.strftime("%Y-%m-%d"),
            'to': target_date.strftime("%Y-%m-%d"),
            'channel': 'EnergyProductionTotal,SavingsCO2'
        }
        aggr_response = api_request(f"pvsystems/{system.pv_system_id}/aggrdata", params=aggr_params)
        
        # API call 2: Get current power and status from flow data
        flow_response = api_request(f"pvsystems/{system.pv_system_id}/flowdata")
        
        # Extract values
        energy_wh = find_channel_value(aggr_response, "EnergyProductionTotal") or 0
        co2_kg = find_channel_value(aggr_response, "SavingsCO2") or 0
        power_w = find_channel_value(flow_response, "PowerPV") or 0
        
        # Determine status
        is_online = flow_response.get('status', {}).get('isOnline', False) if flow_response else False
        status = "online" if is_online else "offline"
        
        # Calculate earnings
        energy_kwh = energy_wh / 1000.0
        earnings = energy_kwh * EARNINGS_RATE_PER_KWH
        
        # Create DynamoDB item
        item = {
            'PK': f'System#{system.pv_system_id}',
            'SK': f'DATA#DAILY#{target_date.strftime("%Y-%m-%d")}',
            'systemId': system.pv_system_id,
            'systemName': system.name,
            'date': target_date.strftime("%Y-%m-%d"),
            'dataType': 'DAILY_CONSOLIDATED',
            'energyProductionWh': Decimal(str(round(energy_wh, 2))),
            'currentPowerW': Decimal(str(round(power_w, 2))),
            'status': status,
            'co2Savings': Decimal(str(round(co2_kg, 2))),
            'earnings': Decimal(str(round(earnings, 2))),
            'createdAt': datetime.utcnow().isoformat(),
            'updatedAt': datetime.utcnow().isoformat()
        }
        
        # Store in DynamoDB
        table.put_item(Item=item)
        logger.info(f"✅ Stored daily data for {system.name}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Error storing daily data for {system.name}: {str(e)}")
        return False

def store_weekly_data(system: PvSystemMetadata, target_date: datetime) -> bool:
    """Store weekly data - makes 1 API call (aggr only)"""
    try:
        logger.info(f"Storing weekly data for {system.name}")
        
        monday_date = get_first_day_of_week(target_date)
        
        # API call: Get energy and CO2 from aggregated data
        aggr_params = {
            'from': monday_date.strftime("%Y-%m-%d"),
            'to': target_date.strftime("%Y-%m-%d"),
            'channel': 'EnergyProductionTotal,SavingsCO2'
        }
        aggr_response = api_request(f"pvsystems/{system.pv_system_id}/aggrdata", params=aggr_params)
        
        # Extract values
        energy_wh = find_channel_value(aggr_response, "EnergyProductionTotal") or 0
        co2_kg = find_channel_value(aggr_response, "SavingsCO2") or 0
        
        # Calculate earnings
        energy_kwh = energy_wh / 1000.0
        earnings = energy_kwh * EARNINGS_RATE_PER_KWH
        
        # Create DynamoDB item
        item = {
            'PK': f'System#{system.pv_system_id}',
            'SK': f'DATA#WEEKLY#{monday_date.strftime("%Y-%m-%d")}',
            'systemId': system.pv_system_id,
            'systemName': system.name,
            'weekStart': monday_date.strftime("%Y-%m-%d"),
            'dataType': 'WEEKLY_CONSOLIDATED',
            'energyProductionWh': Decimal(str(round(energy_wh, 2))),
            'co2Savings': Decimal(str(round(co2_kg, 2))),
            'earnings': Decimal(str(round(earnings, 2))),
            'createdAt': datetime.utcnow().isoformat(),
            'updatedAt': datetime.utcnow().isoformat()
        }
        
        # Store in DynamoDB
        table.put_item(Item=item)
        logger.info(f"✅ Stored weekly data for {system.name}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Error storing weekly data for {system.name}: {str(e)}")
        return False

def store_monthly_data(system: PvSystemMetadata, target_date: datetime) -> bool:
    """Store monthly data - makes 1 API call (aggr only)"""
    try:
        logger.info(f"Storing monthly data for {system.name}")
        
        month_start = get_first_day_of_month(target_date)
        
        # API call: Get energy and CO2 from aggregated data
        aggr_params = {
            'from': month_start.strftime("%Y-%m"),
            'to': target_date.strftime("%Y-%m"),
            'channel': 'EnergyProductionTotal,SavingsCO2'
        }
        aggr_response = api_request(f"pvsystems/{system.pv_system_id}/aggrdata", params=aggr_params)
        
        # Extract values
        energy_wh = find_channel_value(aggr_response, "EnergyProductionTotal") or 0
        co2_kg = find_channel_value(aggr_response, "SavingsCO2") or 0
        
        # Calculate earnings
        energy_kwh = energy_wh / 1000.0
        earnings = energy_kwh * EARNINGS_RATE_PER_KWH
        
        # Create DynamoDB item
        item = {
            'PK': f'System#{system.pv_system_id}',
            'SK': f'DATA#MONTHLY#{target_date.strftime("%Y-%m")}',
            'systemId': system.pv_system_id,
            'systemName': system.name,
            'month': target_date.strftime("%Y-%m"),
            'dataType': 'MONTHLY_CONSOLIDATED',
            'energyProductionWh': Decimal(str(round(energy_wh, 2))),
            'co2Savings': Decimal(str(round(co2_kg, 2))),
            'earnings': Decimal(str(round(earnings, 2))),
            'createdAt': datetime.utcnow().isoformat(),
            'updatedAt': datetime.utcnow().isoformat()
        }
        
        # Store in DynamoDB
        table.put_item(Item=item)
        logger.info(f"✅ Stored monthly data for {system.name}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Error storing monthly data for {system.name}: {str(e)}")
        return False

def store_yearly_data(system: PvSystemMetadata, target_date: datetime) -> bool:
    """Store yearly data - makes 1 API call (aggr only)"""
    try:
        logger.info(f"Storing yearly data for {system.name}")
        
        year_start = get_first_day_of_year(target_date)
        
        # API call: Get energy and CO2 from aggregated data
        aggr_params = {
            'from': year_start.strftime("%Y"),
            'to': target_date.strftime("%Y"),
            'channel': 'EnergyProductionTotal,SavingsCO2'
        }
        aggr_response = api_request(f"pvsystems/{system.pv_system_id}/aggrdata", params=aggr_params)
        
        # Extract values
        energy_wh = find_channel_value(aggr_response, "EnergyProductionTotal") or 0
        co2_kg = find_channel_value(aggr_response, "SavingsCO2") or 0
        
        # Calculate earnings
        energy_kwh = energy_wh / 1000.0
        earnings = energy_kwh * EARNINGS_RATE_PER_KWH
        
        # Create DynamoDB item
        item = {
            'PK': f'System#{system.pv_system_id}',
            'SK': f'DATA#YEARLY#{target_date.strftime("%Y")}',
            'systemId': system.pv_system_id,
            'systemName': system.name,
            'year': target_date.strftime("%Y"),
            'dataType': 'YEARLY_CONSOLIDATED',
            'energyProductionWh': Decimal(str(round(energy_wh, 2))),
            'co2Savings': Decimal(str(round(co2_kg, 2))),
            'earnings': Decimal(str(round(earnings, 2))),
            'createdAt': datetime.utcnow().isoformat(),
            'updatedAt': datetime.utcnow().isoformat()
        }
        
        # Store in DynamoDB
        table.put_item(Item=item)
        logger.info(f"✅ Stored yearly data for {system.name}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Error storing yearly data for {system.name}: {str(e)}")
        return False

def process_system(system: PvSystemMetadata, target_date: datetime) -> Dict[str, bool]:
    """Process all data for a single system"""
    logger.info(f"Processing system: {system.name}")
    
    results = {
        'daily': store_daily_data(system, target_date),
        'weekly': store_weekly_data(system, target_date),
        'monthly': store_monthly_data(system, target_date),
        'yearly': store_yearly_data(system, target_date)
    }
    
    return results

def update_stats_thread_safe(stats, key, increment=1):
    """Thread-safe stats update"""
    with stats_lock:
        stats[key] += increment

def process_systems_concurrently():
    """Main function to process all systems in batches of 8 with 3-second delays"""
    start_time = time.time()
    utc_now = datetime.utcnow()
    
    # Adjust by subtracting 5 hours for EST (UTC -5)
    today = utc_now - timedelta(hours=5)
    
    # Initialize statistics
    stats = {
        'systems_processed': 0,
        'consolidated_entries_stored': 0,
        'errors': 0,
        'api_calls_made': 0
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
        
        logger.info(f"Found {len(pv_systems)} PV systems. Starting batch processing...")
        
        # Process systems in batches of 8 with 3-second delays between batches
        batch_size = 32
        total_batches = (len(pv_systems) + batch_size - 1) // batch_size
        
        for batch_num in range(total_batches):
            start_idx = batch_num * batch_size
            end_idx = min(start_idx + batch_size, len(pv_systems))
            batch_systems = pv_systems[start_idx:end_idx]
            
            logger.info(f"Processing batch {batch_num + 1}/{total_batches}: systems {start_idx + 1}-{end_idx}")
            
            # Process current batch concurrently
            with ThreadPoolExecutor(max_workers=batch_size) as executor:
                # Submit all systems in current batch
                future_to_system = {
                    executor.submit(process_system, system, today): system 
                    for system in batch_systems
                }
                
                # Wait for all systems in this batch to complete
                for future in as_completed(future_to_system):
                    system = future_to_system[future]
                    try:
                        results = future.result()
                        
                        # Count successful entries
                        successful_entries = sum(1 for success in results.values() if success)
                        failed_entries = len(results) - successful_entries
                        
                        update_stats_thread_safe(stats, 'consolidated_entries_stored', successful_entries)
                        update_stats_thread_safe(stats, 'systems_processed')
                        update_stats_thread_safe(stats, 'api_calls_made', 5)  # Daily: 2 calls, Others: 1 each = 5 total
                        
                        if failed_entries > 0:
                            update_stats_thread_safe(stats, 'errors', failed_entries)
                        
                        logger.info(f"✅ Completed system {system.name}: {successful_entries}/4 entries stored")
                        
                    except Exception as e:
                        logger.error(f"❌ Error processing system {system.name}: {str(e)}")
                        update_stats_thread_safe(stats, 'errors', 4)  # Count all 4 periods as failed
            
            # Add 3-second delay between batches (except after the last batch)
            if batch_num < total_batches - 1:
                logger.info(f"Batch {batch_num + 1} completed. Waiting 0.5 seconds before next batch...")
                time.sleep(0.5)
        
        end_time = time.time()
        execution_time = end_time - start_time
        
        # Add execution time to stats
        stats['execution_time'] = execution_time
        
        logger.info("=== POLLING COMPLETED ===")
        logger.info(f"⏱️  Total execution time: {execution_time:.2f} seconds")
        logger.info(f"🏭 Systems processed: {stats['systems_processed']}")
        logger.info(f"💾 Consolidated entries stored: {stats['consolidated_entries_stored']}")
        logger.info(f"🌐 Total API calls made: {stats['api_calls_made']}")
        logger.info(f"⚡ Average time per system: {execution_time/len(pv_systems):.2f} seconds")
        logger.info(f"❌ Errors: {stats['errors']}")
        
        if stats['errors'] > 0:
            logger.warning(f"⚠️  Completed with {stats['errors']} errors")
        else:
            logger.info("✅ All systems processed successfully!")
            
        return stats
        
    except Exception as e:
        logger.error(f"Critical error in processing: {str(e)}")
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
                'message': 'Polling execution failed'
            })
        }

def test_sns():
    """Send a simple test message to the SNS topic"""
    try:
        topic_arn = "arn:aws:sns:us-east-1:381492109487:solarSystemAlerts"
        
        message = {
            "default": "Test message from Solar Polling Script",
            "subject": "SNS Test Alert",
            "timestamp": datetime.utcnow().isoformat(),
            "message": "This is a test message to verify SNS functionality"
        }
        
        response = sns.publish(
            TopicArn=topic_arn,
            Subject="Solar System Test Alert",
            Message=json.dumps(message),
            MessageStructure='json',
            MessageAttributes={
                'source': {
                    'DataType': 'String',
                    'StringValue': 'polling-script'
                },
                'test': {
                    'DataType': 'String', 
                    'StringValue': 'true'
                }
            }
        )
        
        logger.info(f"✅ Test SNS message sent successfully. Message ID: {response['MessageId']}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Error sending test SNS message: {str(e)}")
        return False

if __name__ == "__main__":
    result = process_systems_concurrently()
    print(json.dumps(result, indent=2)) 
    test_sns()
    print("SNS test completed")
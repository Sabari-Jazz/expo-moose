import os
import json
import logging
import requests
import boto3
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Union

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('polling')

# Configuration
API_BASE_URL = os.environ.get('API_BASE_URL', 'https://api.solarweb.com/swqapi')
ACCESS_KEY_ID = os.environ.get('SOLAR_WEB_ACCESS_KEY_ID', 'FKIA08F3E94E3D064B629EE82A44C8D1D0A6')
ACCESS_KEY_VALUE = os.environ.get('SOLAR_WEB_ACCESS_KEY_VALUE', '2f62d6f2-77e6-4796-9fd1-5d74b5c6474c')
USER_ID = os.environ.get('SOLAR_WEB_USERID', 'monitoring@jazzsolar.com')
PASSWORD = os.environ.get('SOLAR_WEB_PASSWORD', 'solar123')

# AWS Configuration
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
DYNAMODB_TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'Moose-DDB')

# Initialize DynamoDB client
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
table = dynamodb.Table(DYNAMODB_TABLE_NAME)

# Type definitions based on the TypeScript interfaces
class ApiChannel:
    def __init__(self, channel_name: str, channel_type: str, unit: str, value: Union[float, None]):
        self.channel_name = channel_name
        self.channel_type = channel_type
        self.unit = unit
        self.value = value

class AggregatedDataItem:
    def __init__(self, log_date_time: str, channels: List[ApiChannel]):
        self.log_date_time = log_date_time
        self.channels = channels

class AggregatedDataResponse:
    def __init__(self, pv_system_id: str, device_id: Optional[str], data: List[AggregatedDataItem]):
        self.pv_system_id = pv_system_id
        self.device_id = device_id
        self.data = data

class PvSystemMetadata:
    def __init__(self, pv_system_id: str, name: str):
        self.pv_system_id = pv_system_id
        self.name = name

class InverterMetadata:
    def __init__(self, device_id: str, device_name: str, device_type: str):
        self.device_id = device_id
        self.device_name = device_name
        self.device_type = device_type


def get_jwt_token() -> str:
    """
    Get a JWT token for authentication with the Solar.web API
    """
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
    
    try:
        logger.info(f"Requesting JWT token from {endpoint}")
        response = requests.post(endpoint, headers=headers, json=payload)
        response.raise_for_status()
        
        data = response.json()
        if 'jwtToken' not in data:
            raise ValueError("JWT response is missing the jwtToken field")
        
        logger.info("JWT Token obtained successfully")
        return data['jwtToken']
        
    except Exception as e:
        logger.error(f"Error obtaining JWT token: {str(e)}")
        raise


def api_request(endpoint: str, method: str = 'GET', params: Dict[str, Any] = None, body: Dict[str, Any] = None) -> Dict[str, Any]:
    """
    Make an authenticated request to the Solar.web API
    """
    jwt_token = get_jwt_token()
    
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
    
    headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'AccessKeyId': ACCESS_KEY_ID,
        'AccessKeyValue': ACCESS_KEY_VALUE,
        'Authorization': f'Bearer {jwt_token}'
    }
    
    try:
        logger.info(f"Making API request to {url} with method {method}")
        
        if method == 'GET':
            response = requests.get(url, headers=headers)
        elif method == 'POST':
            response = requests.post(url, headers=headers, json=body)
        else:
            raise ValueError(f"Unsupported HTTP method: {method}")
        
        response.raise_for_status()
        
        # Return the JSON response or empty dict if no content
        if response.status_code == 204:
            return {}
        
        return response.json()
        
    except Exception as e:
        logger.error(f"API request failed for endpoint {endpoint}: {str(e)}")
        raise


def get_pv_systems() -> List[PvSystemMetadata]:
    """
    Get a list of all PV systems
    """
    try:
        response = api_request('pvsystems')
        
        if 'pvSystems' not in response:
            logger.warning("No PV systems found in the response")
            return []
        
        pv_systems = []
        for system in response['pvSystems']:
            pv_systems.append(PvSystemMetadata(
                pv_system_id=system['pvSystemId'],
                name=system['name']
            ))
        
        logger.info(f"Found {len(pv_systems)} PV systems")
        return pv_systems
        
    except Exception as e:
        logger.error(f"Failed to get PV systems: {str(e)}")
        return []


def get_pv_system_devices(pv_system_id: str, device_type: str = 'Inverter') -> List[InverterMetadata]:
    """
    Get all devices of a specific type for a PV system
    """
    try:
        params = {'type': device_type}
        response = api_request(f"pvsystems/{pv_system_id}/devices", params=params)
        
        if 'devices' not in response:
            logger.warning(f"No devices found for PV system {pv_system_id}")
            return []
        
        inverters = []
        for device in response['devices']:
            inverters.append(InverterMetadata(
                device_id=device['deviceId'],
                device_name=device.get('deviceName', ''),
                device_type=device.get('deviceType', '')
            ))
        
        logger.info(f"Found {len(inverters)} inverters for PV system {pv_system_id}")
        return inverters
        
    except Exception as e:
        logger.error(f"Failed to get devices for PV system {pv_system_id}: {str(e)}")
        return []


def get_pv_system_aggregated_data(pv_system_id: str, params: Dict[str, Any]) -> AggregatedDataResponse:
    """
    Get aggregated data for a PV system
    """
    try:
        response = api_request(f"pvsystems/{pv_system_id}/aggrdata", params=params)
        
        # Simplify and convert the response to our model
        data_items = []
        for item in response.get('data', []):
            channels = []
            for channel in item.get('channels', []):
                channels.append(ApiChannel(
                    channel_name=channel.get('channelName', ''),
                    channel_type=channel.get('channelType', ''),
                    unit=channel.get('unit', ''),
                    value=channel.get('value')
                ))
            
            data_items.append(AggregatedDataItem(
                log_date_time=item.get('logDateTime', ''),
                channels=channels
            ))
        
        return AggregatedDataResponse(
            pv_system_id=response.get('pvSystemId', ''),
            device_id=response.get('deviceId'),
            data=data_items
        )
        
    except Exception as e:
        logger.error(f"Failed to get aggregated data for PV system {pv_system_id}: {str(e)}")
        raise


def find_channel_value(channels: List[ApiChannel], channel_name: str) -> Optional[float]:
    """
    Find a specific channel value in the list of channels
    """
    for channel in channels:
        if channel.channel_name == channel_name:
            return channel.value
    return None


def store_daily_data_in_dynamodb(pv_system_id: str, inverter_id: str, date_str: str, energy_production: float) -> None:
    """
    Store daily energy production data in DynamoDB
    """
    try:
        # Construct the DynamoDB item
        item = {
            'PK': f'User#1',  # Using a default user ID
            'SK': f'Inverter#{inverter_id}',
            'GSI1PK': f'Inverter#{inverter_id}',
            'GSI1SK': f'DATA#DAILY#{date_str}',
            'energyProduction': energy_production,
            'date': date_str,
            'updatedAt': datetime.utcnow().isoformat()
        }
        
        # Put the item in DynamoDB
        table.put_item(Item=item)
        logger.info(f"Stored daily data for inverter {inverter_id} on {date_str}: {energy_production} kWh")
        
    except Exception as e:
        logger.error(f"Failed to store data in DynamoDB: {str(e)}")
        raise


def poll_and_store_data() -> None:
    """
    Main function to poll the solar.web API and store data in DynamoDB
    """
    try:
        # Get the current date in YYYY-MM-DD format
        today = datetime.utcnow().strftime("%Y-%m-%d")
        
        # Get all PV systems
        pv_systems = get_pv_systems()
        
        for system in pv_systems:
            logger.info(f"Processing PV system: {system.name} ({system.pv_system_id})")
            
            # Get all inverters for the PV system
            inverters = get_pv_system_devices(system.pv_system_id, device_type='Inverter')
            
            # For each inverter, get and store the energy production data
            for inverter in inverters:
                logger.info(f"Processing inverter: {inverter.device_name} ({inverter.device_id})")
                
                # Get aggregated data for the inverter for today
                params = {
                    'from': today,
                    'duration': 1,
                    'channel': 'EnergyProductionTotal'
                }
                
                try:
                    aggr_data = get_pv_system_aggregated_data(system.pv_system_id, params)
                    
                    # Process the data if available
                    if aggr_data.data and len(aggr_data.data) > 0:
                        # Get the energy production value
                        energy_produced = find_channel_value(
                            aggr_data.data[0].channels,
                            'EnergyProductionTotal'
                        )
                        
                        if energy_produced is not None:
                            # Convert to kWh with 2 decimal places
                            energy_kwh = round(energy_produced / 1000, 2)
                            
                            # Store in DynamoDB
                            store_daily_data_in_dynamodb(
                                system.pv_system_id,
                                inverter.device_id,
                                today,
                                energy_kwh
                            )
                        else:
                            logger.warning(f"No energy production data for inverter {inverter.device_id} on {today}")
                    else:
                        logger.warning(f"No data available for inverter {inverter.device_id} on {today}")
                        
                except Exception as e:
                    logger.error(f"Error processing inverter {inverter.device_id}: {str(e)}")
                    continue
        
        logger.info("Data polling and storage completed successfully")
        
    except Exception as e:
        logger.error(f"Error in poll_and_store_data: {str(e)}")


# Entry point - can be called by AWS Lambda or run as a script
def lambda_handler(event, context):
    """
    AWS Lambda handler
    """
    try:
        poll_and_store_data()
        return {
            'statusCode': 200,
            'body': json.dumps('Data polling completed successfully')
        }
    except Exception as e:
        logger.error(f"Lambda execution failed: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps(f'Error: {str(e)}')
        }


# Allow the script to be run directly
if __name__ == "__main__":
    poll_and_store_data() 
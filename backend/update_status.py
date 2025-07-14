"""
Update System Status Lambda Function

This Lambda function subscribes to SNS notifications from device status polling
and updates the system status in DynamoDB based on individual device changes.

Key Features:
- Triggered by SNS messages from device_status_polling.py
- Updates system status records in DynamoDB
- Categorizes inverters by status (green, red, moon)
- Determines overall system status based on inverter statuses
- Only updates if there are actual changes to minimize DynamoDB writes

Logic:
- If ANY red inverters: system status = "red"
- Else if ALL inverters are moon: system status = "moon"  
- Else: system status = "green"

Usage:
- Deploy as AWS Lambda function
- Configure SNS trigger with the same topic as device_status_polling.py
- Set environment variables for DynamoDB access
"""

import os
import json
import logging
import boto3
from datetime import datetime
from typing import List, Dict, Any
from decimal import Decimal
import botocore.config

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('update_status')

# AWS Configuration
AWS_REGION = os.environ.get('AWS_REGION_', 'us-east-1')
DYNAMODB_TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'Moose-DDB')

# Configure DynamoDB
dynamodb_config = botocore.config.Config(
    max_pool_connections=50
)
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION, config=dynamodb_config)
table = dynamodb.Table(DYNAMODB_TABLE_NAME)

def get_inverter_statuses(system_id: str) -> Dict[str, List[str]]:
    """Get current status of all inverters for a system, categorized by status"""
    try:
        green_inverters = []
        red_inverters = []
        moon_inverters = []
        # Query for all inverter status records for this system
        response = table.scan(
            FilterExpression=boto3.dynamodb.conditions.Attr('PK').begins_with('Inverter#') & 
                           boto3.dynamodb.conditions.Attr('SK').eq('STATUS') &
                           boto3.dynamodb.conditions.Attr('pvSystemId').eq(system_id)
        )
        for item in response.get('Items', []):
            # Extract device ID from PK
            device_id = item.get('device_id', '')
            status = item.get('status', 'Moon')  # Default to Moon if no status
            
            if status == 'green':
                green_inverters.append(device_id)
            elif status == 'red':
                red_inverters.append(device_id)
            elif status == 'Moon':  # Capital M as used in device_status_polling.py
                moon_inverters.append(device_id)
            else:
                # Unknown status, treat as Moon (default safe state)
                moon_inverters.append(device_id)
        
        while 'LastEvaluatedKey' in response:
            response = table.scan(
                ExclusiveStartKey=response['LastEvaluatedKey'],
                FilterExpression=boto3.dynamodb.conditions.Attr('PK').begins_with('Inverter#') & 
                            boto3.dynamodb.conditions.Attr('SK').eq('STATUS') &
                           boto3.dynamodb.conditions.Attr('pvSystemId').eq(system_id)
            )
                    
            for item in response.get('Items', []):
                # Extract device ID from PK
                device_id = item.get('device_id', '')
                status = item.get('status', 'Moon')  # Default to Moon if no status
                
                if status == 'green':
                    green_inverters.append(device_id)
                elif status == 'red':
                    red_inverters.append(device_id)
                elif status == 'Moon':  # Capital M as used in device_status_polling.py
                    moon_inverters.append(device_id)
                else:
                    # Unknown status, treat as Moon (default safe state)
                    moon_inverters.append(device_id)
        
        logger.info(f"System {system_id} inverter status breakdown:")
        logger.info(f"  Green: {len(green_inverters)} inverters")
        logger.info(f"  Red: {len(red_inverters)} inverters")
        logger.info(f"  Moon: {len(moon_inverters)} inverters")
        
        return {
            'green': green_inverters,
            'red': red_inverters,
            'moon': moon_inverters
        }
        
    except Exception as e:
        logger.error(f"Error getting inverter statuses for system {system_id}: {str(e)}")
        return {
            'green': [],
            'red': [],
            'moon': []
        }

def determine_system_status(green_inverters: List[str], red_inverters: List[str], moon_inverters: List[str]) -> str:
    """Determine overall system status based on inverter statuses"""
    # If one of the inverters is red, then overall status is red
    if len(red_inverters) > 0:
        return "red"
    # Else if all inverters are in moon state, then overall status is moon
    elif len(moon_inverters) > 0 and len(green_inverters) == 0:
        return "moon"
    # Else it is green
    else:
        return "green"

def get_current_system_status(system_id: str) -> Dict[str, Any]:
    """Get current system status record from DynamoDB"""
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
            # Return default structure if no record exists
            return {
                'PK': f'System#{system_id}',
                'SK': 'STATUS',
                'pvSystemId': system_id,
                'status': 'moon',
                'GreenInverters': [],
                'RedInverters': [],
                'MoonInverters': [],
                'TotalInverters': 0,
                'lastUpdated': None
            }
            
    except Exception as e:
        logger.error(f"Error getting current system status for {system_id}: {str(e)}")
        return {
            'PK': f'System#{system_id}',
            'SK': 'STATUS',
            'pvSystemId': system_id,
            'status': 'moon',
            'GreenInverters': [],
            'RedInverters': [],
            'MoonInverters': [],
            'TotalInverters': 0,
            'lastUpdated': None
        }

def update_system_status(system_id: str, green_inverters: List[str], red_inverters: List[str], moon_inverters: List[str]) -> bool:
    """Update system status in DynamoDB"""
    try:
        # Determine overall system status
        overall_status = determine_system_status(green_inverters, red_inverters, moon_inverters)
        
        # Get current system status to check for changes
        current_status_record = get_current_system_status(system_id)
        
        # Convert current lists to sets for comparison (handle None values)
        current_green = set(current_status_record.get('GreenInverters', []) or [])
        current_red = set(current_status_record.get('RedInverters', []) or [])
        current_moon = set(current_status_record.get('MoonInverters', []) or [])
        current_overall = current_status_record.get('status', 'moon')
        
        # Convert new lists to sets
        new_green = set(green_inverters)
        new_red = set(red_inverters)
        new_moon = set(moon_inverters)
        
        # Check if there are any changes
        if (current_green == new_green and 
            current_red == new_red and 
            current_moon == new_moon and 
            current_overall == overall_status):
            
            logger.info(f"No changes detected for system {system_id}, skipping update")
            return True
        
        # Create updated status record
        current_time = datetime.utcnow().isoformat()
        total_inverters = len(green_inverters) + len(red_inverters) + len(moon_inverters)
        
        status_record = {
            'PK': f'System#{system_id}',
            'SK': 'STATUS',
            'pvSystemId': system_id,
            'status': overall_status,
            'GreenInverters': green_inverters,
            'RedInverters': red_inverters,
            'MoonInverters': moon_inverters,
            'TotalInverters': total_inverters,
            'lastUpdated': current_time
        }
        
        # Update DynamoDB
        table.put_item(Item=status_record)
        
        # Log the update
        status_emoji = {"green": "✅", "red": "🔴", "moon": "🌙"}.get(overall_status, "❓")
        logger.info(f"{status_emoji} Updated system {system_id} status to {overall_status}")
        logger.info(f"  Green: {len(green_inverters)}, Red: {len(red_inverters)}, Moon: {len(moon_inverters)}")
        
        return True
        
    except Exception as e:
        logger.error(f"Error updating system status for {system_id}: {str(e)}")
        return False

def process_device_status_change(device_id: str, system_id: str, new_status: str, previous_status: str) -> bool:
    """Process a single device status change and update system status if needed"""
    try:
        logger.info(f"Processing device status change: {device_id} ({system_id}) {previous_status} → {new_status}")
        
        # Get current status of all inverters for this system
        inverter_statuses = get_inverter_statuses(system_id)
        
        # Update system status based on current inverter statuses
        success = update_system_status(
            system_id,
            inverter_statuses['green'],
            inverter_statuses['red'],
            inverter_statuses['moon']
        )
        
        if success:
            logger.info(f"✅ Successfully processed status change for device {device_id}")
        else:
            logger.error(f"❌ Failed to process status change for device {device_id}")
        
        return success
        
    except Exception as e:
        logger.error(f"Error processing device status change for {device_id}: {str(e)}")
        return False

def lambda_handler(event, context):
    """AWS Lambda handler function triggered by SNS"""
    try:
        logger.info("=== UPDATE STATUS LAMBDA TRIGGERED ===")
        logger.info(f"Received event: {json.dumps(event, indent=2)}")
        
        processed_count = 0
        success_count = 0
        
        # Process each SNS record
        for record in event.get('Records', []):
            if record.get('EventSource') == 'aws:sns':
                try:
                    # Parse SNS message
                    message_body = record['Sns']['Message']
                    message_data = json.loads(message_body)
                    
                    # Extract device information
                    device_id = message_data.get('deviceId')
                    system_id = message_data.get('pvSystemId')
                    new_status = message_data.get('newStatus')
                    previous_status = message_data.get('previousStatus')
                    
                    if not all([device_id, system_id, new_status, previous_status]):
                        logger.warning(f"Incomplete message data: {message_data}")
                        continue
                    
                    processed_count += 1
                    
                    # Process the device status change
                    success = process_device_status_change(device_id, system_id, new_status, previous_status)
                    
                    if success:
                        success_count += 1
                    
                except Exception as e:
                    logger.error(f"Error processing SNS record: {str(e)}")
                    continue
        
        logger.info(f"=== UPDATE STATUS COMPLETED ===")
        logger.info(f"📊 Processed: {processed_count} messages")
        logger.info(f"✅ Successful: {success_count} updates")
        logger.info(f"❌ Failed: {processed_count - success_count} updates")
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'processed': processed_count,
                'successful': success_count,
                'failed': processed_count - success_count
            })
        }
        
    except Exception as e:
        logger.error(f"Critical error in lambda handler: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }


def get_all_system_ids() -> List[str]:
    """Fetch all SystemIds by querying for PK begins with 'System#' and SK = 'PROFILE'"""
    system_ids = []
    
    try:
        # Initial scan request
        response = table.scan(
            FilterExpression='begins_with(PK, :prefix) AND SK = :sk',
            ExpressionAttributeValues={
                ':prefix': 'System#',
                ':sk': 'PROFILE'
            }
        )
        
        # Process initial batch
        for item in response['Items']:
            # Extract system ID from PK (remove 'System#' prefix)
            system_id = item['PK'].replace('System#', '')
            system_ids.append(system_id)
            
        logger.info(f"Found {len(response['Items'])} systems in initial batch")
        
        # Handle pagination
        while 'LastEvaluatedKey' in response:
            response = table.scan(
                ExclusiveStartKey=response['LastEvaluatedKey'],
                FilterExpression='begins_with(PK, :prefix) AND SK = :sk',
                ExpressionAttributeValues={
                    ':prefix': 'System#',
                    ':sk': 'PROFILE'
                }
            )
            
            # Process paginated batch
            for item in response['Items']:
                system_id = item['PK'].replace('System#', '')
                system_ids.append(system_id)
                
            logger.info(f"Found {len(response['Items'])} systems in paginated batch")
            
        logger.info(f"Total systems found: {len(system_ids)}")
        return system_ids
        
    except Exception as e:
        logger.error(f"Error fetching system IDs: {str(e)}")
        return []


def create_test_event(system_id: str) -> Dict[str, Any]:
    """Create a test SNS event for triggering lambda handler"""
    message_data = {
        'deviceId': '1234',
        'pvSystemId': system_id,
        'newStatus': 'test',
        'previousStatus': 'test'
    }
    
    event = {
        'Records': [
            {
                'EventSource': 'aws:sns',
                'Sns': {
                    'Message': json.dumps(message_data)
                }
            }
        ]
    }
    
    return event


if __name__ == "__main__":
    print("=== FETCHING ALL SYSTEM IDS AND TRIGGERING LAMBDA ===")
    
    # Fetch all system IDs
    system_ids = get_all_system_ids()
    
    if not system_ids:
        print("No systems found!")
        exit(1)
    
    print(f"Found {len(system_ids)} systems. Processing each one...")
    
    # Process each system
    processed_count = 0
    success_count = 0
    
    for system_id in system_ids:
        try:
            print(f"\nProcessing system: {system_id}")
            
            # Create test event
            event = create_test_event(system_id)
            
            # Trigger lambda handler
            context = None  # Mock context for testing
            result = lambda_handler(event, context)
            
            processed_count += 1
            
            if result.get('statusCode') == 200:
                success_count += 1
                print(f"✅ Successfully processed system {system_id}")
            else:
                print(f"❌ Failed to process system {system_id}: {result}")
                
        except Exception as e:
            print(f"❌ Error processing system {system_id}: {str(e)}")
            processed_count += 1
    
    print(f"\n=== PROCESSING COMPLETE ===")
    print(f"📊 Total systems processed: {processed_count}")
    print(f"✅ Successful: {success_count}")
    print(f"❌ Failed: {processed_count - success_count}")



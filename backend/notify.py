"""
Solar System Notification Handler

This script handles incoming SNS messages for solar system status changes
and sends push notifications to relevant users via the Expo Push Notification service.

Key Features:
- Processes SNS messages for status changes
- Looks up users with access to each system
- Gathers Expo push tokens from all relevant user devices
- Sends notifications in a single batch request to Expo for efficiency
- No DynamoDB status updates (handled by status_polling.py)

Usage:
- As AWS Lambda: deploy and configure with SNS trigger.
- Note: This function requires the 'requests' library to be included in the deployment package.
"""

import json
import logging
import os
import boto3
import requests
from typing import List, Dict, Any
from datetime import datetime
from boto3.dynamodb.conditions import Key
# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('notify')

# AWS Configuration
AWS_REGION = os.environ.get('AWS_REGION_', 'us-east-1')

# Initialize DynamoDB client
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
table = dynamodb.Table(os.environ.get('DYNAMODB_TABLE_NAME', 'Moose-DDB'))

# Initialize SNS client (still needed for receiving triggers, but not for sending)
sns = boto3.client('sns', region_name=AWS_REGION)

def get_users_with_system_access(system_id: str) -> List[str]:
    """Get all users who have access to the specified system"""
    try:
        # Always include admin user ID (hardcoded)
        ADMIN_USER_ID = "04484418-1051-70ea-d0d3-afb45eadb6e7"
        user_ids = [ADMIN_USER_ID]
        

        response = table.query(
            IndexName='user-system-index',  # <- your actual GSI name
            KeyConditionExpression=Key('GSI1PK').eq(f'System#{system_id}') & Key('GSI1SK').begins_with('User#'),
        )
        logger.info(f"Query response: {response}")
        
        for item in response.get('Items', []):
            user_id = item.get('userId')
                # Avoid duplicates in case admin is already in the system access list
            if user_id not in user_ids:
                user_ids.append(user_id)
        
        logger.info(f"Found {len(user_ids)} users with access to system {system_id} (including admin)")
        return user_ids
        
    except Exception as e:
        logger.error(f"Error getting users for system {system_id}: {str(e)}")
        # Even if there's an error, always return admin user ID
        return ["04484418-1051-70ea-d0d3-afb45eadb6e7"]

def get_user_devices(user_id: str) -> List[Dict[str, Any]]:
    """Get all logged-in devices for a user"""
    try:
        response = table.query(
            KeyConditionExpression='PK = :pk AND begins_with(SK, :sk)',
            ExpressionAttributeValues={
                ':pk': f'User#{user_id}',
                ':sk': 'Device#'
            }
        )
        
        devices = []
        for item in response.get('Items', []):
            # Only check if device has push token (don't require isActive field)
            if item.get('pushToken'):
                devices.append({
                    'deviceId': item.get('deviceId'),
                    'pushToken': item.get('pushToken'),
                    'platform': item.get('platform', 'unknown')
                })
        
        logger.info(f"Found {len(devices)} active devices for user {user_id}")
        return devices
        
    except Exception as e:
        logger.error(f"Error getting devices for user {user_id}: {str(e)}")
        return []

def get_device_name(device_id: str, pv_system_id: str) -> str:
    """Get device name from DynamoDB, fallback to device ID"""
    try:
        response = table.get_item(
            Key={
                'PK': f'Inverter<{device_id}>',
                'SK': 'STATUS'
            }
        )
        
        if 'Item' in response:
            # Could potentially have device name in the future
            return f"Inverter {device_id[:8]}"
        else:
            return f"Inverter {device_id[:8]}"
            
    except Exception as e:
        logger.error(f"Error getting device name for {device_id}: {str(e)}")
        return f"Inverter {device_id[:8]}"

def get_system_name(system_id: str) -> str:
    """Get system name from DynamoDB"""
    try:
        
       
        response = table.get_item(
            Key={
                'PK': f'System#{system_id}',
                'SK': 'PROFILE'
            }
        )
        
        if 'Item' in response:
            return response['Item'].get('name', response['Item'].get('pvSystemName', f'System {system_id[:8]}'))
        
        return f'System {system_id[:8]}'
            
    except Exception as e:
        logger.error(f"Error getting system name for {system_id}: {str(e)}")
        return f'System {system_id[:8]}'

def format_notification_message(display_name: str, new_status: str, previous_status: str, power: float, is_device: bool = False) -> Dict[str, str]:
    """Format notification title and body based on status change"""
    
    status_emojis = {
        'green': '✅',
        'red': '🔴', 
        'offline': '🔌'
    }
    
    status_names = {
        'green': 'Online',
        'red': 'Error',
        'offline': 'Offline'
    }
    
    new_emoji = status_emojis.get(new_status, '⚡')
    new_name = status_names.get(new_status, new_status.title())
    
    device_type = "Inverter" if is_device else "System"
    title = f"{new_emoji} {display_name} Status Changed"
    
    if new_status == 'green':
        if previous_status == 'red':
            body = f"{device_type} recovered and is now online. Current power: {power:,.0f}W"
        elif previous_status == 'offline':
            body = f"{device_type} is back online. Current power: {power:,.0f}W"
        else:
            body = f"{device_type} status: {new_name}. Current power: {power:,.0f}W"
    elif new_status == 'red':
        body = f"{device_type} has errors and needs attention. Current power: {power:,.0f}W"
    elif new_status == 'offline':
        body = f"{device_type} is offline and not responding."
    else:
        body = f"Status changed from {previous_status} to {new_status}"
    
    return {
        'title': title,
        'body': body
    }

def send_expo_notifications(tokens: List[str], title: str, body: str, data: Dict[str, Any]) -> bool:
    """Sends push notifications to a list of Expo push tokens in a single batch."""
    messages = []
    for token in tokens:
        # Basic validation to ensure it's an Expo token
        if token.startswith('ExponentPushToken['):
            messages.append({
                'to': token,
                'sound': 'default',
                'title': title,
                'body': body,
                'data': data
            })
    
    if not messages:
        logger.warning("No valid Expo push tokens to send notifications to.")
        return True # Return true as there's no error, just no one to notify

    try:
        response = requests.post(
            'https://exp.host/--/api/v2/push/send',
            headers={
                'Accept': 'application/json',
                'Accept-encoding': 'gzip, deflate',
                'Content-Type': 'application/json',
            },
            json=messages,
            timeout=30
        )
        response.raise_for_status()
        
        response_data = response.json().get('data', [])
        success_count = sum(1 for ticket in response_data if ticket.get('status') == 'ok')
        error_count = len(response_data) - success_count

        logger.info(f"✅ Sent notifications to Expo. Success: {success_count}, Errors: {error_count}")
        
        # Log detailed errors if any
        if error_count > 0:
            for ticket in response_data:
                if ticket.get('status') == 'error':
                    logger.error(f"Expo push error: {ticket.get('message')} - Details: {ticket.get('details')}")

        return error_count == 0

    except requests.exceptions.RequestException as e:
        logger.error(f"❌ Error sending notifications to Expo API: {str(e)}")
        return False

def process_status_change_notification(sns_message: Dict[str, Any]) -> Dict[str, int]:
    """Process a status change notification from SNS (supports both system and device level)"""
    stats = {
        'users_found': 0,
        'devices_found': 0,
        'notifications_sent': 0,
        'errors': 0
    }
    
    try:
        # Determine if this is a device-level or system-level notification
        device_id = sns_message.get('deviceId')  # New device-level format
        system_id = sns_message.get('pvSystemId')  # Always present
        new_status = sns_message.get('newStatus')
        previous_status = sns_message.get('previousStatus')
        power = sns_message.get('power', 0)
        
        if not all([system_id, new_status, previous_status]):
            logger.error("Missing required fields in SNS message")
            stats['errors'] += 1
            return stats
        
        is_device_notification = device_id is not None
        
        if is_device_notification:
            logger.info(f"Processing device-level status change notification for device {device_id} in system {system_id}: {previous_status} → {new_status}")
            display_name = get_device_name(device_id, system_id)
            data_payload = {
                'deviceId': device_id,
                'systemId': system_id,
                'type': 'device_status_change'
            }
        else:
            logger.info(f"Processing system-level status change notification for system {system_id}: {previous_status} → {new_status}")
            display_name = get_system_name(system_id)
            data_payload = {
                'systemId': system_id,
                'type': 'system_status_change'
            }
        
        # Get users with access to this system
        user_ids = get_users_with_system_access(system_id)
        stats['users_found'] = len(user_ids)
        
        if not user_ids:
            logger.warning(f"No users found with access to system {system_id}")
            return stats

        # Collect all device tokens for all users with access
        all_expo_tokens = []
        total_devices = 0
        for user_id in user_ids:
            devices = get_user_devices(user_id)
            total_devices += len(devices)
            for device in devices:
                # Add token if it's not already in the list
                if device.get('pushToken') and device['pushToken'] not in all_expo_tokens:
                    all_expo_tokens.append(device['pushToken'])
        
        stats['devices_found'] = total_devices

        if not all_expo_tokens:
            logger.warning(f"No active devices with push tokens found for system {system_id}")
            return stats

        # Format notification message
        notification = format_notification_message(
            display_name, new_status, previous_status, power, is_device_notification
        )
        
        # Send one batch of notifications via Expo
        success = send_expo_notifications(
            tokens=all_expo_tokens,
            title=notification['title'],
            body=notification['body'],
            data=data_payload
        )
        
        if success:
            stats['notifications_sent'] = len(all_expo_tokens)
        else:
            stats['errors'] += len(all_expo_tokens)
        
        notification_type = "device" if is_device_notification else "system"
        logger.info(f"✅ {notification_type.title()}-level notification processing complete for {system_id}. Attempted to send to {stats['notifications_sent']} devices.")
        return stats
        
    except Exception as e:
        logger.error(f"❌ Error processing status change notification: {str(e)}")
        stats['errors'] += 1
        return stats

def lambda_handler(event, context):
    """AWS Lambda handler function triggered by SNS"""
    try:
        logger.info("Notification handler started")
        
        total_stats = {
            'messages_processed': 0,
            'users_found': 0,
            'devices_found': 0,
            'notifications_sent': 0,
            'errors': 0
        }
        
        # Process SNS records
        for record in event.get('Records', []):
            if record.get('EventSource') == 'aws:sns':
                try:
                    # Parse SNS message
                    sns_message = json.loads(record['Sns']['Message'])
                    
                    # Process the status change
                    stats = process_status_change_notification(sns_message)
                    
                    # Aggregate stats
                    total_stats['messages_processed'] += 1
                    total_stats['users_found'] += stats['users_found']
                    total_stats['devices_found'] += stats['devices_found']
                    total_stats['notifications_sent'] += stats['notifications_sent']
                    total_stats['errors'] += stats['errors']
                    
                except Exception as e:
                    logger.error(f"Error processing SNS record: {str(e)}")
                    total_stats['errors'] += 1
        
        logger.info("=== NOTIFICATION PROCESSING COMPLETED ===")
        logger.info(f"📨 Messages processed: {total_stats['messages_processed']}")
        logger.info(f"👥 Users found: {total_stats['users_found']}")
        logger.info(f"📱 Devices found: {total_stats['devices_found']}")
        logger.info(f"🔔 Notifications sent: {total_stats['notifications_sent']}")
        logger.info(f"❌ Errors: {total_stats['errors']}")
        
        return {
            'statusCode': 200,
            'body': json.dumps(total_stats)
        }
        
    except Exception as e:
        logger.error(f"Lambda execution failed: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': str(e),
                'message': 'Notification processing failed'
            })
        } 
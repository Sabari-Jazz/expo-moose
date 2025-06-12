"""
Solar System Notification Handler

This script handles incoming SNS messages for solar system status changes
and sends push notifications to relevant users based on their system access.

Key Features:
- Processes SNS messages for status changes
- Looks up users with access to each system
- Sends push notifications to logged-in devices
- Handles notification content formatting
- No DynamoDB status updates (handled by status_polling.py)

Usage:
- As AWS Lambda: deploy and configure with SNS trigger
"""

import json
import logging
import os
import boto3
from typing import List, Dict, Any

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('notify')

# AWS Configuration
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')

# Initialize DynamoDB client
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
table = dynamodb.Table(os.environ.get('DYNAMODB_TABLE_NAME', 'Moose-DDB'))

# Initialize SNS client for push notifications
sns = boto3.client('sns', region_name=AWS_REGION)

def get_users_with_system_access(system_id: str) -> List[str]:
    """Get all users who have access to the specified system"""
    try:
        # Query for reverse link entries: System#{system_id} -> User#{user_id}
        response = table.query(
            KeyConditionExpression='PK = :pk AND begins_with(SK, :sk)',
            ExpressionAttributeValues={
                ':pk': f'System#{system_id}',
                ':sk': 'User#'
            }
        )
        
        user_ids = []
        for item in response.get('Items', []):
            if item.get('SK', '').startswith('User#'):
                user_id = item['SK'].replace('User#', '')
                user_ids.append(user_id)
        
        logger.info(f"Found {len(user_ids)} users with access to system {system_id}")
        return user_ids
        
    except Exception as e:
        logger.error(f"Error getting users for system {system_id}: {str(e)}")
        return []

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
            # Check if device has push token and is active
            if item.get('pushToken') and item.get('isActive', False):
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

def get_system_name(system_id: str) -> str:
    """Get system name from DynamoDB"""
    try:
        response = table.get_item(
            Key={
                'PK': f'System#{system_id}',
                'SK': 'METADATA'
            }
        )
        
        if 'Item' in response:
            return response['Item'].get('name', f'System {system_id[:8]}')
        else:
            return f'System {system_id[:8]}'
            
    except Exception as e:
        logger.error(f"Error getting system name for {system_id}: {str(e)}")
        return f'System {system_id[:8]}'

def format_notification_message(system_name: str, new_status: str, previous_status: str, power: float) -> Dict[str, str]:
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
    
    title = f"{new_emoji} {system_name} Status Changed"
    
    if new_status == 'green':
        if previous_status == 'red':
            body = f"System recovered and is now online. Current power: {power:,.0f}W"
        elif previous_status == 'offline':
            body = f"System is back online. Current power: {power:,.0f}W"
        else:
            body = f"System status: {new_name}. Current power: {power:,.0f}W"
    elif new_status == 'red':
        body = f"System has errors and needs attention. Current power: {power:,.0f}W"
    elif new_status == 'offline':
        body = "System is offline and not responding."
    else:
        body = f"Status changed from {previous_status} to {new_status}"
    
    return {
        'title': title,
        'body': body
    }

def send_push_notification(device_token: str, platform: str, title: str, body: str, system_id: str) -> bool:
    """Send push notification to a device"""
    try:
        # Create the message payload based on platform
        if platform.lower() == 'ios':
            message_payload = {
                "aps": {
                    "alert": {
                        "title": title,
                        "body": body
                    },
                    "sound": "default",
                    "badge": 1
                },
                "systemId": system_id,
                "type": "status_change"
            }
            message = {
                "APNS": json.dumps(message_payload)
            }
        else:  # Android
            message_payload = {
                "notification": {
                    "title": title,
                    "body": body
                },
                "data": {
                    "systemId": system_id,
                    "type": "status_change"
                }
            }
            message = {
                "GCM": json.dumps(message_payload)
            }
        
        # Create platform application endpoint
        endpoint_response = sns.create_platform_endpoint(
            PlatformApplicationArn=get_platform_arn(platform),
            Token=device_token
        )
        
        endpoint_arn = endpoint_response['EndpointArn']
        
        # Send the notification
        response = sns.publish(
            TargetArn=endpoint_arn,
            Message=json.dumps(message),
            MessageStructure='json'
        )
        
        logger.info(f"✅ Push notification sent successfully. Message ID: {response['MessageId']}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Error sending push notification: {str(e)}")
        return False

def get_platform_arn(platform: str) -> str:
    """Get the platform application ARN for iOS or Android"""
    if platform.lower() == 'ios':
        return os.environ.get('SNS_IOS_PLATFORM_ARN', 'arn:aws:sns:us-east-1:381492109487:app/APNS/MooseApp')
    else:
        return os.environ.get('SNS_ANDROID_PLATFORM_ARN', 'arn:aws:sns:us-east-1:381492109487:app/GCM/MooseApp')

def process_status_change_notification(sns_message: Dict[str, Any]) -> Dict[str, int]:
    """Process a status change notification from SNS"""
    stats = {
        'users_found': 0,
        'devices_found': 0,
        'notifications_sent': 0,
        'errors': 0
    }
    
    try:
        system_id = sns_message.get('pvSystemId')
        new_status = sns_message.get('newStatus')
        previous_status = sns_message.get('previousStatus')
        power = sns_message.get('power', 0)
        
        if not all([system_id, new_status, previous_status]):
            logger.error("Missing required fields in SNS message")
            stats['errors'] += 1
            return stats
        
        logger.info(f"Processing status change notification for system {system_id}: {previous_status} → {new_status}")
        
        # Get system name
        system_name = get_system_name(system_id)
        
        # Get users with access to this system
        user_ids = get_users_with_system_access(system_id)
        stats['users_found'] = len(user_ids)
        
        if not user_ids:
            logger.warning(f"No users found with access to system {system_id}")
            return stats
        
        # Format notification message
        notification = format_notification_message(system_name, new_status, previous_status, power)
        
        # Send notifications to all user devices
        for user_id in user_ids:
            devices = get_user_devices(user_id)
            stats['devices_found'] += len(devices)
            
            for device in devices:
                success = send_push_notification(
                    device['pushToken'],
                    device['platform'],
                    notification['title'],
                    notification['body'],
                    system_id
                )
                
                if success:
                    stats['notifications_sent'] += 1
                else:
                    stats['errors'] += 1
        
        logger.info(f"✅ Notification processing complete for {system_id}. Sent {stats['notifications_sent']} notifications")
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

if __name__ == "__main__":
    # Test with sample event
    test_event = {
        'Records': [{
            'EventSource': 'aws:sns',
            'Sns': {
                'Message': json.dumps({
                    'pvSystemId': 'test-system-id',
                    'newStatus': 'green',
                    'previousStatus': 'red',
                    'timestamp': '2025-01-15T10:30:00Z',
                    'power': 5000
                })
            }
        }]
    }
    
    result = lambda_handler(test_event, None)
    print(json.dumps(result, indent=2)) 
"""
Solar System Technician Notification Handler

This script handles incoming SNS messages for solar system status changes
and sends email notifications to technicians when systems go offline or have errors.

Key Features:
- Processes SNS messages for status changes (only offline/red statuses)
- Looks up users with access to each system
- Fetches technician email from user profiles
- Sends formatted email notifications via AWS SES
- Includes Google Forms link for technician response

Usage:
- As AWS Lambda: deploy and configure with SNS trigger.
- Requires AWS SES permissions for sending emails.
"""

import json
import logging
import os
import boto3
from typing import List, Dict, Any, Set
from datetime import datetime
from boto3.dynamodb.conditions import Key

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('notify_technician')

# AWS Configuration
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
table = dynamodb.Table(os.environ.get('DYNAMODB_TABLE_NAME', 'Moose-DDB'))
ses_client = boto3.client('ses', region_name=AWS_REGION)

def get_users_with_system_access(system_id: str) -> List[str]:
    """Get all users who have access to the specified system - EXACT COPY from notify.py"""
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

def get_system_name(system_id: str) -> str:
    """Get system name from DynamoDB - EXACT COPY from notify.py"""
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

def get_device_name(device_id: str, pv_system_id: str) -> str:
    """Get device name from DynamoDB - EXACT COPY from notify.py"""
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

def get_technician_emails(user_ids: List[str]) -> Set[str]:
    """Get technician emails from user profiles"""
    technician_emails = set()
    
    for user_id in user_ids:
        try:
            response = table.get_item(
                Key={
                    'PK': f'User#{user_id}',
                    'SK': 'PROFILE'
                }
            )
            
            if 'Item' in response:
                technician_email = response['Item'].get('technician_email')
                if technician_email and technician_email.strip():
                    technician_emails.add(technician_email.strip())
                    logger.info(f"Found technician email for user {user_id}: {technician_email}")
                else:
                    logger.warning(f"No technician_email found for user {user_id}")
            else:
                logger.warning(f"No profile found for user {user_id}")
                
        except Exception as e:
            logger.error(f"Error getting technician email for user {user_id}: {str(e)}")
    
    logger.info(f"Collected {len(technician_emails)} unique technician emails")
    return technician_emails

def format_email_content(display_name: str, new_status: str, previous_status: str, power: float, system_id: str, is_device: bool = False) -> Dict[str, str]:
    """Format email subject and body for technician notification"""
    
    status_emojis = {
        'red': '🔴',
        'offline': '🔌'
    }
    
    status_names = {
        'red': 'Error',
        'offline': 'Offline'
    }
    
    emoji = status_emojis.get(new_status, '⚠️')
    status_name = status_names.get(new_status, new_status.title())
    device_type = "Inverter" if is_device else "System"
    
    # Email subject
    subject = f"URGENT: {device_type} {status_name} - {display_name}"
    
    # Email body with formatted message and Google Forms link
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S UTC")
    
    if new_status == 'red':
        issue_description = f"{device_type} has errors and requires immediate attention."
        priority = "HIGH"
    elif new_status == 'offline':
        issue_description = f"{device_type} is offline and not responding."
        priority = "CRITICAL"
    else:
        issue_description = f"Status changed from {previous_status} to {new_status}."
        priority = "MEDIUM"
    
    # Google Forms placeholder link
    google_forms_link = "https://forms.google.com/placeholder-technician-response"
    
    body = f"""
SOLAR SYSTEM ALERT - TECHNICIAN NOTIFICATION

System Information:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• {device_type}: {display_name}
• System ID: {system_id}
• Status: {status_name} {emoji}
• Previous Status: {previous_status.title()}
• Current Power: {power:,.0f}W
• Priority: {priority}
• Timestamp: {timestamp}

Issue Description:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{issue_description}

Action Required:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Please investigate this issue and take appropriate action. 

RESPOND TO THIS ALERT:
Click here to log your response: {google_forms_link}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This is an automated notification from the Solar Monitoring System.
Location: Lac des Mille Lacs First Nation (LDMLFN)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
    
    return {
        'subject': subject,
        'body': body
    }

def send_technician_emails(emails: Set[str], subject: str, body: str) -> bool:
    """Send email notifications to technicians via AWS SES"""
    if not emails:
        logger.warning("No technician emails to send notifications to.")
        return True
    
    success_count = 0
    error_count = 0
    
    # Send individual emails to each technician
    for email in emails:
        try:
            response = ses_client.send_email(
                Source=os.environ.get('SES_FROM_EMAIL', 'noreply@jazzsolar.com'),
                Destination={
                    'ToAddresses': [email]
                },
                Message={
                    'Subject': {
                        'Data': subject,
                        'Charset': 'UTF-8'
                    },
                    'Body': {
                        'Text': {
                            'Data': body,
                            'Charset': 'UTF-8'
                        }
                    }
                }
            )
            
            logger.info(f"✅ Email sent successfully to {email}. SES MessageId: {response['MessageId']}")
            success_count += 1
            
        except Exception as e:
            logger.error(f"❌ Failed to send email to {email}: {str(e)}")
            error_count += 1
    
    logger.info(f"Email sending complete. Success: {success_count}, Errors: {error_count}")
    return error_count == 0

def should_notify_technician(new_status: str, previous_status: str) -> bool:
    """Check if technician should be notified based on status change"""
    # Only notify for changes TO offline or red status
    # Don't care if something switches back to green
    if new_status in ['offline', 'red']:
        logger.info(f"Status changed to {new_status} - technician notification required")
        return True
    
    logger.info(f"Status changed to {new_status} - no technician notification needed")
    return False

def process_technician_notification(sns_message: Dict[str, Any]) -> Dict[str, int]:
    """Process a status change notification for technician alerts"""
    stats = {
        'users_found': 0,
        'technician_emails_found': 0,
        'emails_sent': 0,
        'errors': 0
    }
    
    try:
        # Extract message details
        device_id = sns_message.get('deviceId')  # New device-level format
        system_id = sns_message.get('pvSystemId')  # Always present
        new_status = sns_message.get('newStatus')
        previous_status = sns_message.get('previousStatus')
        power = sns_message.get('power', 0)
        
        if not all([system_id, new_status, previous_status]):
            logger.error("Missing required fields in SNS message")
            stats['errors'] += 1
            return stats
        
        # Check if we should notify technician
        if not should_notify_technician(new_status, previous_status):
            logger.info("No technician notification needed for this status change")
            return stats
        
        is_device_notification = device_id is not None
        
        if is_device_notification:
            logger.info(f"Processing device-level technician notification for device {device_id} in system {system_id}: {previous_status} → {new_status}")
            display_name = get_device_name(device_id, system_id)
        else:
            logger.info(f"Processing system-level technician notification for system {system_id}: {previous_status} → {new_status}")
            display_name = get_system_name(system_id)
        
        # Get users with access to this system (using exact logic from notify.py)
        user_ids = get_users_with_system_access(system_id)
        stats['users_found'] = len(user_ids)
        
        if not user_ids:
            logger.warning(f"No users found with access to system {system_id}")
            return stats
        
        # Get technician emails from user profiles
        technician_emails = get_technician_emails(user_ids)
        stats['technician_emails_found'] = len(technician_emails)
        
        if not technician_emails:
            logger.warning(f"No technician emails found for system {system_id}")
            return stats
        
        # Format email content
        email_content = format_email_content(
            display_name, new_status, previous_status, power, system_id, is_device_notification
        )
        
        # Send emails to technicians
        success = send_technician_emails(
            emails=technician_emails,
            subject=email_content['subject'],
            body=email_content['body']
        )
        
        if success:
            stats['emails_sent'] = len(technician_emails)
        else:
            stats['errors'] += len(technician_emails)
        
        notification_type = "device" if is_device_notification else "system"
        logger.info(f"✅ {notification_type.title()}-level technician notification processing complete for {system_id}. Sent emails to {stats['emails_sent']} technicians.")
        return stats
        
    except Exception as e:
        logger.error(f"❌ Error processing technician notification: {str(e)}")
        stats['errors'] += 1
        return stats

def lambda_handler(event, context):
    """AWS Lambda handler function triggered by SNS"""
    try:
        logger.info("Technician notification handler started")
        
        total_stats = {
            'messages_processed': 0,
            'users_found': 0,
            'technician_emails_found': 0,
            'emails_sent': 0,
            'errors': 0
        }
        
        # Process SNS records
        for record in event.get('Records', []):
            if record.get('EventSource') == 'aws:sns':
                try:
                    # Parse SNS message
                    sns_message = json.loads(record['Sns']['Message'])
                    
                    # Process the technician notification
                    stats = process_technician_notification(sns_message)
                    
                    # Aggregate stats
                    total_stats['messages_processed'] += 1
                    total_stats['users_found'] += stats['users_found']
                    total_stats['technician_emails_found'] += stats['technician_emails_found']
                    total_stats['emails_sent'] += stats['emails_sent']
                    total_stats['errors'] += stats['errors']
                    
                except Exception as e:
                    logger.error(f"Error processing SNS record: {str(e)}")
                    total_stats['errors'] += 1
        
        logger.info("=== TECHNICIAN NOTIFICATION PROCESSING COMPLETED ===")
        logger.info(f"📨 Messages processed: {total_stats['messages_processed']}")
        logger.info(f"👥 Users found: {total_stats['users_found']}")
        logger.info(f"📧 Technician emails found: {total_stats['technician_emails_found']}")
        logger.info(f"✉️ Emails sent: {total_stats['emails_sent']}")
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
                'message': 'Technician notification processing failed'
            })
        } 
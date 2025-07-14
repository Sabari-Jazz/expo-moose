"""
Solar System Technician Notification Handler - EventBridge Scheduler Version

This script handles EventBridge scheduler triggers for incident-based technician notifications.
It processes incidents that have been pending for 1 hour and sends email notifications to technicians.

Key Features:
- Triggered by EventBridge scheduler (1 hour after incident creation)
- Receives incident_id and user_id from EventBridge payload
- Fetches incident record from DynamoDB
- Checks incident status (pending/dismissed)
- Sends email to technician if still pending
- Marks incident as processed and deletes schedule
- Skips notification if incident was dismissed

Usage:
- As AWS Lambda: deploy and configure with EventBridge scheduler trigger
- Requires AWS SES permissions for sending emails
- Requires EventBridge scheduler permissions for cleanup
"""

import json
import logging
import os
import boto3
from typing import Dict, Any, Optional
from datetime import datetime
from boto3.dynamodb.conditions import Key

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('notify_technician_scheduled')

# AWS Configuration
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
table = dynamodb.Table(os.environ.get('DYNAMODB_TABLE_NAME', 'Moose-DDB'))
ses_client = boto3.client('ses', region_name=AWS_REGION)
scheduler = boto3.client('scheduler', region_name=AWS_REGION)

def get_incident_record(incident_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    """Fetch incident record from DynamoDB"""
    try:
        response = table.get_item(
            Key={
                'PK': f'Incident#{incident_id}',
                'SK': f'User#{user_id}'
            }
        )
        
        if 'Item' in response:
            logger.info(f"Found incident record for incident {incident_id}, user {user_id}")
            return response['Item']
        else:
            logger.warning(f"No incident record found for incident {incident_id}, user {user_id}")
            return None
            
    except Exception as e:
        logger.error(f"Error fetching incident record {incident_id}: {str(e)}")
        return None

def get_user_profile(user_id: str) -> Optional[Dict[str, Any]]:
    """Get user profile from DynamoDB"""
    try:
        response = table.get_item(
            Key={
                'PK': f'User#{user_id}',
                'SK': 'PROFILE'
            }
        )
        
        if 'Item' in response:
            return response['Item']
        else:
            logger.warning(f"No profile found for user {user_id}")
            return None
            
    except Exception as e:
        logger.error(f"Error getting user profile for {user_id}: {str(e)}")
        return None

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

def get_device_name(device_id: str) -> str:
    """Get device display name"""
    try:
        return f"Inverter {device_id[:8]}"
    except Exception as e:
        logger.error(f"Error formatting device name for {device_id}: {str(e)}")
        return f"Inverter {device_id[:8] if device_id else 'Unknown'}"

def get_current_device_status(device_id: str) -> Optional[Dict[str, Any]]:
    """Get current device status from DynamoDB"""
    try:
        response = table.get_item(
            Key={
                'PK': f'Inverter#{device_id}',
                'SK': 'STATUS'
            }
        )
        
        if 'Item' in response:
            logger.info(f"Found current status for device {device_id}: {response['Item'].get('status', 'unknown')}")
            return response['Item']
        else:
            logger.warning(f"No current status found for device {device_id}")
            return None
            
    except Exception as e:
        logger.error(f"Error getting current device status for {device_id}: {str(e)}")
        return None

def mark_incident_as_dismissed(incident_id: str, user_id: str, reason: str = "status reverted") -> bool:
    """Mark incident as dismissed in DynamoDB"""
    try:
        table.update_item(
            Key={
                'PK': f'Incident#{incident_id}',
                'SK': f'User#{user_id}'
            },
            UpdateExpression='SET #status = :status, processedAt = :processed_at, dismissedReason = :reason',
            ExpressionAttributeNames={
                '#status': 'status'
            },
            ExpressionAttributeValues={
                ':status': 'dismissed',
                ':processed_at': int(datetime.now().timestamp()),
                ':reason': reason
            }
        )
        
        logger.info(f"✅ Marked incident {incident_id} as dismissed with reason: {reason}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Failed to mark incident {incident_id} as dismissed: {str(e)}")
        return False

def format_technician_email(incident: Dict[str, Any], system_name: str, device_name: str) -> Dict[str, str]:
    """Format email subject and body for technician notification"""
    
    # Extract incident details
    system_id = incident.get('systemId', 'Unknown')
    device_id = incident.get('deviceId', 'Unknown')
    user_id = incident.get('userId', 'Unknown')
    # Convert Decimal to float for datetime.fromtimestamp()
    expires_at = float(incident.get('expiresAt', 0))
    created_time = datetime.fromtimestamp(expires_at - 3600)  # 1 hour before expiry
    
    # Email subject
    subject = f"URGENT: Solar System Alert - {device_name} ({system_name})"
    
    # Email body
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S UTC")
    incident_time = created_time.strftime("%Y-%m-%d %H:%M:%S UTC")
    
    # Google Forms link
    google_forms_link = f"https://docs.google.com/forms/d/e/1FAIpQLSd3Zz3kKNNogw377llp6pNm_yvcqVXi465U2dRClEdYFAzonw/viewform?usp=pp_url&entry.209729194={user_id}"
    
    body = f"""
SOLAR SYSTEM ALERT - TECHNICIAN NOTIFICATION
INCIDENT ESCALATION (1 HOUR PENDING)

System Information:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Device: {device_name}
• System: {system_name}
• System ID: {system_id}
• Device ID: {device_id}
• Incident Created: {incident_time}
• Escalated At: {timestamp}
• Priority: HIGH - REQUIRES ATTENTION

Issue Description:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Device status change detected and has been pending for 1 hour without user response.
This incident requires immediate technician attention.

Action Required:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Please investigate this device/system issue and take appropriate action.

RESPOND TO THIS ALERT:
Click here to log your response: {google_forms_link}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This is an automated escalation from Moose.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
    
    return {
        'subject': subject,
        'body': body
    }

def send_technician_email(email: str, subject: str, body: str) -> bool:
    """Send email notification to technician via AWS SES"""
    try:
        response = ses_client.send_email(
            Source=os.environ.get('SES_FROM_EMAIL', 'sabari@jazzsolar.com'),
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
        return True
        
    except Exception as e:
        logger.error(f"❌ Failed to send email to {email}: {str(e)}")
        return False

def mark_incident_as_processed(incident_id: str, user_id: str) -> bool:
    """Mark incident as processed in DynamoDB"""
    try:
        table.update_item(
            Key={
                'PK': f'Incident#{incident_id}',
                'SK': f'User#{user_id}'
            },
            UpdateExpression='SET #status = :status, processedAt = :processed_at',
            ExpressionAttributeNames={
                '#status': 'status'
            },
            ExpressionAttributeValues={
                ':status': 'processed',
                ':processed_at': int(datetime.now().timestamp())
            }
        )
        
        logger.info(f"✅ Marked incident {incident_id} as processed")
        return True
        
    except Exception as e:
        logger.error(f"❌ Failed to mark incident {incident_id} as processed: {str(e)}")
        return False

def cleanup_schedule(incident_id: str, user_id: str) -> bool:
    """Delete the EventBridge schedule after processing"""
    schedule_name = f"incident-{incident_id[:8]}-user-{user_id[:8]}"
    
    try:
        scheduler.delete_schedule(Name=schedule_name)
        logger.info(f"✅ Deleted EventBridge schedule {schedule_name}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Failed to delete EventBridge schedule {schedule_name}: {str(e)}")
        return False

def process_incident_notification(incident_id: str, user_id: str) -> Dict[str, Any]:
    """Process a scheduled incident notification"""
    result = {
        'incident_id': incident_id,
        'user_id': user_id,
        'status': 'error',
        'action_taken': 'none',
        'email_sent': False,
        'marked_processed': False,
        'schedule_cleaned': False,
        'message': '',
        'new_status': 'unknown'
    }
    
    try:
        # Step 1: Get incident record
        incident = get_incident_record(incident_id, user_id)
        if not incident:
            result['message'] = 'Incident record not found - ignoring'
            result['status'] = 'ignored'
            result['schedule_cleaned'] = cleanup_schedule(incident_id, user_id)
            return result
        
        # Step 2: Check incident status
        incident_status = incident.get('status', 'unknown')
        logger.info(f"Incident {incident_id} status: {incident_status}")
        result['new_status'] = incident.get('newStatus', 'unknown')
        if incident_status == 'dismissed':
            # User dismissed the incident - just mark as processed and cleanup
            result['action_taken'] = 'dismissed_cleanup'
            result['marked_processed'] = mark_incident_as_processed(incident_id, user_id)
            result['schedule_cleaned'] = cleanup_schedule(incident_id, user_id)
            result['message'] = 'Incident was dismissed - cleaned up without email'
            result['status'] = 'success'
            return result
        
        elif incident_status == 'pending':
            # Step 3: Check current device status before proceeding
            device_id = incident.get('deviceId', 'Unknown')
            current_device_status = get_current_device_status(device_id)
            
            if not current_device_status:
                # Can't get current status - proceed with notification as precaution
                logger.warning(f"Could not get current status for device {device_id} - proceeding with notification")
                result['action_taken'] = 'email_sent_no_status_check'
            else:
                # Compare current status with what would trigger incident (red/error status)
                current_status = current_device_status.get('status', 'unknown')
                current_reason = current_device_status.get('reason', '')
                
                logger.info(f"Current device status: {current_status}, reason: {current_reason}")
                
                # If device is now green (recovered), dismiss the incident
                if current_status == 'green':
                    logger.info(f"Device {device_id} has recovered (status: green) - dismissing incident")
                    result['action_taken'] = 'dismissed_status_reverted'
                    result['marked_processed'] = mark_incident_as_dismissed(incident_id, user_id, "Incident was dismissed - status reverted")
                    result['schedule_cleaned'] = cleanup_schedule(incident_id, user_id)
                    result['message'] = 'Incident was dismissed - status reverted'
                    result['status'] = 'success'
                    return result
                
                # If device is still in error state (red or other non-green), proceed with notification
                logger.info(f"Device {device_id} still in error state ({current_status}) - proceeding with technician notification")
                result['action_taken'] = 'email_sent_status_confirmed'
            
            # Step 4: Get user profile for technician email
            user_profile = get_user_profile(user_id)
            if not user_profile:
                result['message'] = 'User profile not found - ignoring'
                result['status'] = 'ignored'
                result['schedule_cleaned'] = cleanup_schedule(incident_id, user_id)
                return result
            
            technician_email = user_profile.get('technician_email')
            if not technician_email or not technician_email.strip():
                result['message'] = 'No technician email found - ignoring'
                result['status'] = 'ignored'
                result['marked_processed'] = mark_incident_as_processed(incident_id, user_id)
                result['schedule_cleaned'] = cleanup_schedule(incident_id, user_id)
                return result
            
            # Step 5: Get system and device names
            system_id = incident.get('systemId', 'Unknown')
            system_name = get_system_name(system_id)
            device_name = get_device_name(device_id)
            
            # Step 6: Format and send email
            email_content = format_technician_email(incident, system_name, device_name)
            result['email_sent'] = send_technician_email(
                technician_email.strip(),
                email_content['subject'],
                email_content['body']
            )
            
            # Step 7: Mark as processed and cleanup
            result['marked_processed'] = mark_incident_as_processed(incident_id, user_id)
            result['schedule_cleaned'] = cleanup_schedule(incident_id, user_id)
            
            if result['email_sent'] and result['marked_processed']:
                result['status'] = 'success'
                result['message'] = f'Email sent to {technician_email}'
            else:
                result['message'] = 'Partial failure in processing'
            
            return result
        
        else:
            # Unknown status - mark as processed and cleanup
            result['action_taken'] = 'unknown_status_cleanup'
            result['marked_processed'] = mark_incident_as_processed(incident_id, user_id)
            result['schedule_cleaned'] = cleanup_schedule(incident_id, user_id)
            result['message'] = f'Unknown incident status: {incident_status}'
            result['status'] = 'success'
            return result
            
    except Exception as e:
        logger.error(f"❌ Error processing incident notification: {str(e)}")
        result['message'] = f'Processing error: {str(e)}'
        # Try to cleanup schedule even on error
        result['schedule_cleaned'] = cleanup_schedule(incident_id, user_id)
        return result

def lambda_handler(event, context):
    """AWS Lambda handler function triggered by EventBridge Scheduler"""
    try:
        logger.info("Technician notification handler started (EventBridge Scheduler)")
        logger.info(f"Received event: {json.dumps(event)}")
        
        # Extract incident_id and user_id from EventBridge payload
        incident_id = event.get('incident_id')
        user_id = event.get('user_id')
        
        if not incident_id or not user_id:
            logger.error("Missing incident_id or user_id in EventBridge payload")
            return {
                'statusCode': 400,
                'body': json.dumps({
                    'error': 'Missing required fields',
                    'message': 'incident_id and user_id are required'
                })
            }
        
        logger.info(f"Processing incident {incident_id} for user {user_id}")
        
        # Process the incident notification
        result = process_incident_notification(incident_id, user_id)
        
        logger.info("=== INCIDENT PROCESSING COMPLETED ===")
        logger.info(f"🎯 Incident ID: {result['incident_id']}")
        logger.info(f"👤 User ID: {result['user_id']}")
        logger.info(f"✅ Status: {result['status']}")
        logger.info(f"🔧 Action: {result['action_taken']}")
        logger.info(f"📧 Email sent: {result['email_sent']}")
        logger.info(f"📝 Marked processed: {result['marked_processed']}")
        logger.info(f"🗑️ Schedule cleaned: {result['schedule_cleaned']}")
        logger.info(f"💬 Message: {result['message']}")
        
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
                'message': 'Incident notification processing failed'
            })
        } 
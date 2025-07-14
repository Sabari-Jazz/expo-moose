"""
Technician Response Lambda Function
Handles: /dev/handle-tech-response
Processes technician responses from Google Forms and sends notifications to users
"""

import os
import json
import boto3
import requests
from datetime import datetime
from decimal import Decimal
from typing import Dict, List, Optional, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from mangum import Mangum
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# AWS Configuration
AWS_REGION = os.environ.get('AWS_REGION_', 'us-east-1')
DYNAMODB_TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'Moose-DDB')

# Initialize AWS clients
try:
    dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
    table = dynamodb.Table(DYNAMODB_TABLE_NAME)
    ses_client = boto3.client('ses', region_name=AWS_REGION)
    print(f"Connected to DynamoDB table: {DYNAMODB_TABLE_NAME}")
except Exception as e:
    print(f"Failed to connect to AWS services: {str(e)}")
    dynamodb = None
    table = None
    ses_client = None

# Create FastAPI app
app = FastAPI(
    title="Technician Response Service",
    description="Handles technician responses from Google Forms",
    version="0.1.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

#---------------------------------------
# Pydantic Models
#---------------------------------------

class TechnicianResponse(BaseModel):
    """Technician response from Google Forms"""
    timestamp: str = Field(description="Form submission timestamp")
    userId: str = Field(description="User ID from the form")
    accepted: bool = Field(description="Whether technician accepted the job")
    quote: Optional[str] = Field(default=None, description="Quote if accepted")
    reason: Optional[str] = Field(default=None, description="Reason if declined")

class ProcessingResult(BaseModel):
    """Response for technician response processing"""
    success: bool
    message: str
    email_sent: bool = False
    push_sent: bool = False
    user_id: Optional[str] = None

#---------------------------------------
# Helper Functions - Copied from notify_user.py and notify_technician.py
#---------------------------------------

def get_user_profile(user_id: str) -> Optional[Dict[str, Any]]:
    """Get user profile from DynamoDB - COPIED from notify_technician.py"""
    try:
        response = table.get_item(
            Key={
                'PK': f'User#{user_id}',
                'SK': 'PROFILE'
            }
        )
        
        if 'Item' in response:
            # Convert Decimal objects to regular types
            def convert_decimals(obj):
                if isinstance(obj, list):
                    return [convert_decimals(i) for i in obj]
                elif isinstance(obj, dict):
                    return {k: convert_decimals(v) for k, v in obj.items()}
                elif isinstance(obj, Decimal):
                    return float(obj)
                else:
                    return obj
            return convert_decimals(response['Item'])
        else:
            logger.warning(f"No profile found for user {user_id}")
            return None
            
    except Exception as e:
        logger.error(f"Error getting user profile for {user_id}: {str(e)}")
        return None

def get_user_devices(user_id: str) -> List[Dict[str, Any]]:
    """Get all logged-in devices for a user - COPIED from notify_user.py"""
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
            if item.get('expo_push_token'):  # Note: using expo_push_token field name from registration
                devices.append({
                    'deviceId': item.get('device_id', item.get('SK', '').replace('Device#', '')),
                    'pushToken': item.get('expo_push_token'),
                    'platform': item.get('platform', 'unknown')
                })
        
        logger.info(f"Found {len(devices)} active devices for user {user_id}")
        return devices
        
    except Exception as e:
        logger.error(f"Error getting devices for user {user_id}: {str(e)}")
        return []

def send_user_email(email: str, subject: str, body: str) -> bool:
    """Send email notification to user via AWS SES - COPIED from notify_technician.py"""
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

def send_expo_notifications(tokens: List[str], title: str, body: str, data: Dict[str, Any]) -> bool:
    """Sends push notifications to a list of Expo push tokens - COPIED from notify_user.py"""
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

def format_technician_response_email(tech_response: TechnicianResponse) -> Dict[str, str]:
    """Format email subject and body for technician response notification"""
    
    # Format timestamp
    try:
        timestamp_dt = datetime.fromisoformat(tech_response.timestamp.replace('Z', '+00:00'))
        formatted_time = timestamp_dt.strftime("%Y-%m-%d %H:%M:%S UTC")
    except:
        formatted_time = tech_response.timestamp
    
    # Email subject
    if tech_response.accepted:
        subject = "Technician Response: Service Request Accepted"
    else:
        subject = "Technician Response: Service Request Declined"
    
    # Email body
    if tech_response.accepted:
        body = f"""
TECHNICIAN RESPONSE - SERVICE REQUEST ACCEPTED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Good news! Your solar system service request has been accepted by our technician.

Response Details:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Status: ACCEPTED ✅
• Response Time: {formatted_time}
• Quote: {tech_response.quote or 'No quote provided'}

Next Steps:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Our technician will contact you shortly to schedule the service visit.
Please ensure access to your solar system is available.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This is an automated response from the Solar Monitoring System.
Location: Lac des Mille Lacs First Nation (LDMLFN)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
    else:
        body = f"""
TECHNICIAN RESPONSE - SERVICE REQUEST DECLINED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Your solar system service request has been declined by our technician.

Response Details:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Status: DECLINED ❌
• Response Time: {formatted_time}
• Reason: {tech_response.reason or 'No reason provided'}

Next Steps:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Please contact our support team if you have questions about this decision.
Alternative solutions may be available.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This is an automated response from the Solar Monitoring System.
Location: Lac des Mille Lacs First Nation (LDMLFN)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""
    
    return {
        'subject': subject,
        'body': body
    }

def format_technician_response_notification(tech_response: TechnicianResponse) -> Dict[str, str]:
    """Format push notification title and body for technician response"""
    
    if tech_response.accepted:
        title = "Technician Response Received"
        body = "Your technician has accepted the service request"
    else:
        title = "Technician Response Received"
        body = "Your technician has declined the service request"
    
    return {
        'title': title,
        'body': body
    }

def process_technician_response(tech_response: TechnicianResponse) -> ProcessingResult:
    """Process technician response and send notifications to user"""
    result = ProcessingResult(
        success=False,
        message="Processing started",
        user_id=tech_response.userId
    )
    
    try:
        # Step 1: Check if user exists
        user_profile = get_user_profile(tech_response.userId)
        if not user_profile:
            result.message = f"User {tech_response.userId} not found - ending processing"
            result.success = True  # Not an error, just no user to notify
            logger.warning(result.message)
            return result
        
        logger.info(f"Processing technician response for user {tech_response.userId}")
        
        # Step 2: Get user email and devices
        user_email = user_profile.get('email')
        user_devices = get_user_devices(tech_response.userId)
        
        # Step 3: Check if we have email or devices
        if not user_email and not user_devices:
            result.message = "User has no email or devices - nothing to do"
            result.success = True
            logger.warning(result.message)
            return result
        
        # Step 4: Send email if user has email
        email_sent = False
        if user_email and user_email.strip():
            email_content = format_technician_response_email(tech_response)
            email_sent = send_user_email(
                user_email.strip(),
                email_content['subject'],
                email_content['body']
            )
            result.email_sent = email_sent
            if email_sent:
                logger.info(f"✅ Email sent to {user_email}")
            else:
                logger.error(f"❌ Failed to send email to {user_email}")
        else:
            logger.info("No email address found - skipping email notification")
        
        # Step 5: Send push notifications if user has devices
        push_sent = False
        if user_devices:
            push_tokens = [device['pushToken'] for device in user_devices if device.get('pushToken')]
            if push_tokens:
                notification_content = format_technician_response_notification(tech_response)
                data_payload = {
                    'type': 'technician_response',
                    'userId': tech_response.userId,
                    'accepted': tech_response.accepted,
                    'timestamp': tech_response.timestamp
                }
                
                push_sent = send_expo_notifications(
                    push_tokens,
                    notification_content['title'],
                    notification_content['body'],
                    data_payload
                )
                result.push_sent = push_sent
                if push_sent:
                    logger.info(f"✅ Push notifications sent to {len(push_tokens)} devices")
                else:
                    logger.error(f"❌ Failed to send push notifications")
            else:
                logger.info("No valid push tokens found - skipping push notifications")
        else:
            logger.info("No devices found - skipping push notifications")
        
        # Step 6: Determine overall success
        if user_email and user_devices:
            # User has both email and devices - both should succeed
            result.success = email_sent and push_sent
            if result.success:
                result.message = f"Successfully sent email and push notifications to user {tech_response.userId}"
            else:
                result.message = f"Partial success: email={email_sent}, push={push_sent}"
        elif user_email:
            # User only has email
            result.success = email_sent
            result.message = f"Email sent: {email_sent}"
        elif user_devices:
            # User only has devices
            result.success = push_sent
            result.message = f"Push notifications sent: {push_sent}"
        
        return result
        
    except Exception as e:
        logger.error(f"❌ Error processing technician response: {str(e)}")
        result.message = f"Processing error: {str(e)}"
        result.success = False
        return result

#---------------------------------------
# API Endpoints
#---------------------------------------

@app.post("/api/technician-form-submit")
async def handle_technician_response(tech_response: TechnicianResponse):
    """Handle technician response from Google Forms webhook"""
    try:
        logger.info(f"=== TECHNICIAN RESPONSE RECEIVED ===")
        logger.info(f"User ID: {tech_response.userId}")
        logger.info(f"Accepted: {tech_response.accepted}")
        logger.info(f"Quote/Reason: {tech_response.quote or tech_response.reason}")
        logger.info(f"Timestamp: {tech_response.timestamp}")
        
        if not table or not ses_client:
            raise HTTPException(status_code=503, detail="AWS services not available")
        
        # Process the technician response
        result = process_technician_response(tech_response)
        
        logger.info("=== TECHNICIAN RESPONSE PROCESSING COMPLETED ===")
        logger.info(f"��� User ID: {result.user_id}")
        logger.info(f"✅ Success: {result.success}")
        logger.info(f"��� Email sent: {result.email_sent}")
        logger.info(f"��� Push sent: {result.push_sent}")
        logger.info(f"��� Message: {result.message}")
        
        if result.success:
            return {
                "status": "success",
                "message": result.message,
                "email_sent": result.email_sent,
                "push_sent": result.push_sent
            }
        else:
            return {
                "status": "error",
                "message": result.message,
                "email_sent": result.email_sent,
                "push_sent": result.push_sent
            }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"API endpoint error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to process technician response: {str(e)}")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "technician-response",
        "timestamp": datetime.now().isoformat()
    }

# AWS Lambda handler
handler = Mangum(app)

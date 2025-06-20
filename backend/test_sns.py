"""
Test SNS Message Sender

This script simulates sending an SNS message for a device status change
from green to red, mimicking the exact structure used by device_status_polling.py

Usage:
    python test_sns.py
"""

import os
import json
import boto3
import logging
from datetime import datetime

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('test_sns')

# AWS Configuration - using same values as device_status_polling.py
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
SNS_TOPIC_ARN = os.environ.get('SNS_TOPIC_ARN', 'arn:aws:sns:us-east-1:381492109487:solarSystemAlerts')

# Initialize SNS client
sns = boto3.client('sns', region_name=AWS_REGION)

def send_test_device_status_change_sns() -> bool:
    """Send a test SNS message for device status change from green to red"""
    try:
        # Test device and system IDs
        device_id = "test-device-12345678"
        pv_system_id = "bf915090-5f59-4128-a206-46c73f2f779d"  # Using existing system ID
        new_status = "red"
        previous_status = "green"
        power = 1250.5  # Some power value
        
        # Create message - EXACT SAME STRUCTURE as device_status_polling.py
        message = {
            "deviceId": device_id,
            "pvSystemId": pv_system_id,
            "newStatus": new_status,
            "previousStatus": previous_status,
            "timestamp": datetime.utcnow().isoformat(),
            "power": power
        }
        
        logger.info(f"Sending test SNS message:")
        logger.info(f"  Device ID: {device_id}")
        logger.info(f"  System ID: {pv_system_id}")
        logger.info(f"  Status Change: {previous_status} → {new_status}")
        logger.info(f"  Power: {power}W")
        logger.info(f"  SNS Topic: {SNS_TOPIC_ARN}")
        
        # Send SNS message - EXACT SAME STRUCTURE as device_status_polling.py
        response = sns.publish(
            TopicArn=SNS_TOPIC_ARN,
            Subject=f"Solar Inverter Status Change - {device_id}",
            Message=json.dumps(message),
            MessageAttributes={
                'source': {
                    'DataType': 'String',
                    'StringValue': 'test-sns-script'  # Changed to indicate this is a test
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
        
        logger.info(f"✅ Test SNS message sent successfully!")
        logger.info(f"   Message ID: {response['MessageId']}")
        logger.info(f"   This should trigger both notify.py and notify_technician.py Lambda functions")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Error sending test SNS message: {str(e)}")
        return False

def main():
    """Main function to send test SNS message"""
    logger.info("=== SNS TEST MESSAGE SENDER ===")
    logger.info("This script simulates a device status change from green to red")
    logger.info("It will trigger both the push notification and technician email systems")
    logger.info("")
    
    # Check if SNS topic ARN is configured
    if not SNS_TOPIC_ARN or SNS_TOPIC_ARN == 'your-sns-topic-arn':
        logger.error("❌ SNS_TOPIC_ARN environment variable is not properly configured")
        logger.error("Please set: export SNS_TOPIC_ARN='arn:aws:sns:us-east-1:381492109487:solarSystemAlerts'")
        return
    
    # Send test message
    success = send_test_device_status_change_sns()
    
    if success:
        logger.info("")
        logger.info("=== TEST COMPLETED SUCCESSFULLY ===")
        logger.info("Check your Lambda function logs to see if the notifications were processed:")
        logger.info("1. Push notifications should be sent via notify.py")
        logger.info("2. Technician emails should be sent via notify_technician.py")
        logger.info("")
        logger.info("Expected behavior:")
        logger.info("- notify.py: Will send push notifications to all users with access to the system")
        logger.info("- notify_technician.py: Will send emails to technicians (since status changed to 'red')")
    else:
        logger.error("")
        logger.error("=== TEST FAILED ===")
        logger.error("Check AWS credentials and SNS topic configuration")

if __name__ == "__main__":
    main() 
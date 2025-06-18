"""
Solar Notification Handler Test Script

This script provides standalone testing functionality for the notification handler.
It simulates incoming SNS events and triggers the notification handler to test
both device-level and system-level notifications.

Usage:
- Run directly: python notify_test.py
"""

import json
import sys
import os
from datetime import datetime

# Add the current directory to the path so we can import notify
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Import the notification handler
from notify import lambda_handler

def test_notifications():
    """Test both device-level and system-level notifications"""
    print("--- Running Notification Handler in Test Mode ---")

    # Test both device-level and system-level notifications
    
    # 1. Device-level notification (new format from device_status_polling.py)
    test_device_payload = {
        'deviceId': 'INV_12345678',
        'pvSystemId': 'bf915090-5f59-4128-a206-46c73f2f779d',
        'newStatus': 'red',
        'previousStatus': 'green',
        'timestamp': datetime.utcnow().isoformat(),
        'power': 0.0
    }
    
    # 2. System-level notification (original format for backward compatibility)
    test_system_payload = {
        'pvSystemId': 'bf915090-5f59-4128-a206-46c73f2f779d',
        'newStatus': 'green',
        'previousStatus': 'red',
        'timestamp': datetime.utcnow().isoformat(),
        'power': 1250.0
    }

    # Test device-level notification
    print("\n=== Testing Device-Level Notification ===")
    device_event = {
        'Records': [{
            'EventSource': 'aws:sns',
            'Sns': {
                'Message': json.dumps(test_device_payload)
            }
        }]
    }
    
    device_result = lambda_handler(device_event, None)
    print("Device notification result:")
    print(json.dumps(device_result, indent=2))
    
    # Test system-level notification
    print("\n=== Testing System-Level Notification ===")
    system_event = {
        'Records': [{
            'EventSource': 'aws:sns',
            'Sns': {
                'Message': json.dumps(test_system_payload)
            }
        }]
    }
    
    system_result = lambda_handler(system_event, None)
    print("System notification result:")
    print(json.dumps(system_result, indent=2))
    
    print("\n--- Test Run Completed ---")
    print("---------------------------------")

    return {
        'device_result': device_result,
        'system_result': system_result
    }

if __name__ == "__main__":
    test_notifications() 
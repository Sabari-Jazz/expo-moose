"""
Inverter Status Reverter

This script reverts all inverter STATUS entries back to their original clean state.
It deletes all existing Inverter# STATUS entries and recreates them with a simple structure:
- device_id (snake_case)
- pvSystemId
- status (set to "green")
- lastUpdated
- power

Usage:
    python revert_inv_status.py

Environment Variables:
    - AWS_REGION: AWS region (default: us-east-1)
    - DYNAMODB_TABLE_NAME: DynamoDB table name (default: Moose-DDB)
"""

import os
import json
import logging
import boto3
import time
from datetime import datetime
from typing import List, Dict, Any, Optional
from botocore.exceptions import ClientError
from decimal import Decimal

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('status_reverter')

# AWS Configuration
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
DYNAMODB_TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'Moose-DDB')

# Initialize DynamoDB client
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
table = dynamodb.Table(DYNAMODB_TABLE_NAME)


def get_all_inverter_status_entries() -> List[Dict[str, Any]]:
    """
    Scan DynamoDB for all inverter STATUS entries (PK starts with Inverter# and SK = STATUS)
    """
    try:
        logger.info("Scanning DynamoDB for inverter STATUS entries...")
        
        inverter_entries = []
        
        # Use scan with filter expression
        scan_kwargs = {
            'FilterExpression': 'begins_with(PK, :pk_prefix) AND SK = :sk_value',
            'ExpressionAttributeValues': {
                ':pk_prefix': 'Inverter#',
                ':sk_value': 'STATUS'
            }
        }
        
        # Handle pagination
        while True:
            response = table.scan(**scan_kwargs)
            inverter_entries.extend(response.get('Items', []))
            
            # Check if there are more items to scan
            if 'LastEvaluatedKey' not in response:
                break
                
            scan_kwargs['ExclusiveStartKey'] = response['LastEvaluatedKey']
        
        logger.info(f"Found {len(inverter_entries)} inverter STATUS entries in DynamoDB")
        return inverter_entries
        
    except Exception as e:
        logger.error(f"Error scanning DynamoDB for inverter STATUS entries: {str(e)}")
        raise


def extract_essential_data(status_entry: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Extract essential data from a STATUS entry before deletion
    """
    try:
        # Try to get device_id from various possible field names
        device_id = None
        if 'device_id' in status_entry:
            device_id = status_entry['device_id']
        elif 'deviceId' in status_entry:
            device_id = status_entry['deviceId']
        else:
            # Extract from PK if it's in format Inverter#deviceId
            pk = status_entry.get('PK', '')
            if pk.startswith('Inverter#'):
                device_id = pk.replace('Inverter#', '')
        
        pv_system_id = status_entry.get('pvSystemId')
        
        if not device_id:
            logger.warning(f"Could not extract device_id from entry {status_entry.get('PK', 'unknown')}")
            return None
            
        if not pv_system_id:
            logger.warning(f"Could not extract pvSystemId from entry {status_entry.get('PK', 'unknown')}")
            return None
        
        return {
            'device_id': device_id,
            'pvSystemId': pv_system_id,
            'PK': status_entry.get('PK'),
            'SK': status_entry.get('SK')
        }
        
    except Exception as e:
        logger.error(f"Error extracting essential data from entry: {str(e)}")
        return None


def delete_status_entry(pk: str, sk: str) -> bool:
    """
    Delete a STATUS entry from DynamoDB
    """
    try:
        table.delete_item(
            Key={'PK': pk, 'SK': sk}
        )
        logger.info(f"✅ Deleted STATUS entry: {pk}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Error deleting STATUS entry {pk}: {str(e)}")
        return False


def create_clean_status_entry(device_id: str, pv_system_id: str, original_pk: str) -> bool:
    """
    Create a new clean STATUS entry with simple structure
    """
    try:
        # Create clean status entry
        status_entry = {
            'PK': original_pk,  # Keep the same PK format
            'SK': 'STATUS',
            'device_id': device_id,  # Use snake_case as requested
            'pvSystemId': pv_system_id,
            'status': 'green',  # Set to green as requested
            'lastUpdated': datetime.utcnow().isoformat(),
            'power': Decimal('0.0')  # Default power value
        }
        
        table.put_item(Item=status_entry)
        logger.info(f"✅ Created clean STATUS entry: {original_pk}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Error creating clean STATUS entry for {original_pk}: {str(e)}")
        return False


def revert_all_status_entries():
    """
    Main function to revert all inverter STATUS entries to clean state
    """
    start_time = time.time()
    
    # Initialize statistics
    stats = {
        'entries_found': 0,
        'entries_deleted': 0,
        'entries_created': 0,
        'entries_skipped': 0,
        'delete_errors': 0,
        'create_errors': 0,
        'start_time': start_time
    }
    
    try:
        logger.info("=== STARTING INVERTER STATUS REVERT ===")
        
        # Get all inverter STATUS entries from DynamoDB
        status_entries = get_all_inverter_status_entries()
        stats['entries_found'] = len(status_entries)
        
        if not status_entries:
            logger.warning("No inverter STATUS entries found to process")
            return stats
        
        logger.info(f"Processing {len(status_entries)} inverter STATUS entries...")
        
        # First pass: Extract essential data from all entries
        essential_data_list = []
        for i, status_entry in enumerate(status_entries, 1):
            try:
                pk = status_entry.get('PK', 'unknown')
                logger.info(f"Extracting data from entry {i}/{len(status_entries)}: {pk}")
                
                essential_data = extract_essential_data(status_entry)
                if essential_data:
                    essential_data_list.append(essential_data)
                else:
                    logger.warning(f"⚠️  Skipping entry {pk} - could not extract essential data")
                    stats['entries_skipped'] += 1
                    
            except Exception as e:
                stats['entries_skipped'] += 1
                logger.error(f"❌ Error extracting data from entry {status_entry.get('PK', 'unknown')}: {str(e)}")
        
        logger.info(f"Successfully extracted data from {len(essential_data_list)} entries")
        
        # Second pass: Delete all existing STATUS entries
        logger.info("Deleting existing STATUS entries...")
        for i, essential_data in enumerate(essential_data_list, 1):
            try:
                pk = essential_data['PK']
                sk = essential_data['SK']
                
                logger.info(f"Deleting entry {i}/{len(essential_data_list)}: {pk}")
                
                if delete_status_entry(pk, sk):
                    stats['entries_deleted'] += 1
                else:
                    stats['delete_errors'] += 1
                
                # Small delay between deletions
                time.sleep(0.05)
                
            except Exception as e:
                stats['delete_errors'] += 1
                logger.error(f"❌ Error deleting entry {essential_data.get('PK', 'unknown')}: {str(e)}")
        
        # Third pass: Create new clean STATUS entries
        logger.info("Creating new clean STATUS entries...")
        for i, essential_data in enumerate(essential_data_list, 1):
            try:
                device_id = essential_data['device_id']
                pv_system_id = essential_data['pvSystemId']
                original_pk = essential_data['PK']
                
                logger.info(f"Creating clean entry {i}/{len(essential_data_list)}: {original_pk}")
                
                if create_clean_status_entry(device_id, pv_system_id, original_pk):
                    stats['entries_created'] += 1
                else:
                    stats['create_errors'] += 1
                
                # Small delay between creations
                time.sleep(0.05)
                
            except Exception as e:
                stats['create_errors'] += 1
                logger.error(f"❌ Error creating clean entry {essential_data.get('PK', 'unknown')}: {str(e)}")
        
        end_time = time.time()
        execution_time = end_time - start_time
        
        logger.info("=== INVERTER STATUS REVERT COMPLETED ===")
        logger.info(f"⏱️  Total execution time: {execution_time:.2f} seconds")
        logger.info(f"🔍 STATUS entries found: {stats['entries_found']}")
        logger.info(f"🗑️  STATUS entries deleted: {stats['entries_deleted']}")
        logger.info(f"✅ Clean STATUS entries created: {stats['entries_created']}")
        logger.info(f"⏭️  Entries skipped: {stats['entries_skipped']}")
        logger.info(f"❌ Delete errors: {stats['delete_errors']}")
        logger.info(f"❌ Create errors: {stats['create_errors']}")
        
        total_errors = stats['delete_errors'] + stats['create_errors']
        if total_errors > 0:
            logger.warning(f"⚠️  Completed with {total_errors} total errors")
        else:
            logger.info("✅ All STATUS entries reverted successfully!")
            
        return stats
        
    except Exception as e:
        logger.error(f"Critical error in status revert: {str(e)}")
        return stats


if __name__ == "__main__":
    try:
        result = revert_all_status_entries()
        print("\n=== FINAL RESULTS ===")
        print(json.dumps(result, indent=2, default=str))
        
        # Exit with error code if there were errors
        total_errors = result['delete_errors'] + result['create_errors']
        if total_errors > 0:
            exit(1)
        else:
            exit(0)
            
    except Exception as e:
        logger.error(f"Script execution failed: {str(e)}")
        exit(1) 
"""
TTN System Processing Script

This script queries the Moose DynamoDB table for system profiles where PK begins with "System#" 
and SK = "PROFILE". For systems where the name starts with "TTN", it creates user-to-system 
link entries in the database.

Usage:
    python process_ttn_systems.py
"""

import os
import json
import logging
import boto3
from typing import List, Dict, Any
from botocore.exceptions import ClientError

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('ttn_processor')

# AWS Configuration (using same setup as load_db.py)
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
DYNAMODB_TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'Moose-DDB')

# Initialize DynamoDB client
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
table = dynamodb.Table(DYNAMODB_TABLE_NAME)

# Constants
USER_ID = "a4286408-3001-70fd-700c-70fb8ed1936c"
LINK_TYPE = "USER_TO_SYSTEM"


def query_system_profiles() -> List[Dict[str, Any]]:
    """
    Query DynamoDB for all system profiles where PK begins with "System#" and SK = "PROFILE"
    """
    try:
        logger.info("Querying DynamoDB for system profiles...")
        
        # Use scan with filter expression since we need to check all items with PK starting with "System#"
        response = table.scan(
            FilterExpression='begins_with(PK, :pk_prefix) AND SK = :sk_value',
            ExpressionAttributeValues={
                ':pk_prefix': 'System#',
                ':sk_value': 'PROFILE'
            }
        )
        
        items = response.get('Items', [])
        
        # Handle pagination if there are more items
        while 'LastEvaluatedKey' in response:
            logger.info("Fetching more items from DynamoDB...")
            response = table.scan(
                FilterExpression='begins_with(PK, :pk_prefix) AND SK = :sk_value',
                ExpressionAttributeValues={
                    ':pk_prefix': 'System#',
                    ':sk_value': 'PROFILE'
                },
                ExclusiveStartKey=response['LastEvaluatedKey']
            )
            items.extend(response.get('Items', []))
        
        logger.info(f"Found {len(items)} system profile items")
        return items
        
    except ClientError as e:
        logger.error(f"DynamoDB query error: {e}")
        raise
    except Exception as e:
        logger.error(f"Error querying system profiles: {e}")
        raise


def filter_ttn_systems(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Filter items to only include those where the 'name' attribute starts with 'TTN'
    """
    ttn_systems = []
    
    for item in items:
        # Check if the item has a 'name' attribute and it starts with 'TTN'
        name = item.get('name', '')
        if isinstance(name, str) and name.upper().startswith('TTN'):
            # Ensure the item has a systemId
            if 'systemId' in item:
                ttn_systems.append(item)
                logger.info(f"Found TTN system: {name} (systemId: {item['systemId']})")
            else:
                logger.warning(f"TTN system '{name}' is missing systemId attribute")
    
    logger.info(f"Found {len(ttn_systems)} TTN systems")
    return ttn_systems


def create_user_system_link(system_id: str) -> Dict[str, Any]:
    """
    Create a user-to-system link entry for the given system ID
    """
    return {
        "PK": f"User#{USER_ID}",
        "SK": f"System#{system_id}",
        "GSI1PK": f"System#{system_id}",
        "GSI1SK": f"User#{USER_ID}",
        "linkType": LINK_TYPE,
        "systemId": system_id,
        "userId": USER_ID
    }


def add_user_system_link(system_id: str) -> bool:
    """
    Add a user-to-system link entry to DynamoDB
    """
    try:
        link_entry = create_user_system_link(system_id)
        
        # Use put_item to add the entry
        table.put_item(Item=link_entry)
        
        logger.info(f"Successfully added user-to-system link for system {system_id}")
        return True
        
    except ClientError as e:
        logger.error(f"DynamoDB error adding link for system {system_id}: {e}")
        return False
    except Exception as e:
        logger.error(f"Error adding user-to-system link for system {system_id}: {e}")
        return False


def process_ttn_systems():
    """
    Main processing function that queries for system profiles, filters for TTN systems,
    and creates user-to-system links
    """
    try:
        logger.info("Starting TTN system processing...")
        
        # Step 1: Query for all system profiles
        system_profiles = query_system_profiles()
        
        # Step 2: Filter for TTN systems
        ttn_systems = filter_ttn_systems(system_profiles)
        
        if not ttn_systems:
            logger.info("No TTN systems found. Exiting.")
            return
        
        # Step 3: Process each TTN system
        successful_additions = 0
        failed_additions = 0
        
        for system in ttn_systems:
            system_id = system['systemId']
            name = system.get('name', 'Unknown')
            
            logger.info(f"Processing TTN system: {name} (ID: {system_id})")
            
            if add_user_system_link(system_id):
                successful_additions += 1
            else:
                failed_additions += 1
        
        # Step 4: Report results
        logger.info("=" * 50)
        logger.info("PROCESSING COMPLETE")
        logger.info("=" * 50)
        logger.info(f"Total TTN systems found: {len(ttn_systems)}")
        logger.info(f"Successfully added DDB entries: {successful_additions}")
        logger.info(f"Failed additions: {failed_additions}")
        logger.info("=" * 50)
        
        print(f"\nFinal Count: {successful_additions} DDB entries added successfully")
        
    except Exception as e:
        logger.error(f"Error in main processing: {e}")
        raise


if __name__ == "__main__":
    try:
        process_ttn_systems()
    except KeyboardInterrupt:
        logger.info("Process interrupted by user")
    except Exception as e:
        logger.error(f"Script failed: {e}")
        exit(1) 
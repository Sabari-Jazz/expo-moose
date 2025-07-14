"""
Print Status Script
Scans DynamoDB to get all inverter and system status information
Handles pagination properly and provides summary statistics
"""

import os
import boto3
from collections import Counter
from typing import Dict, List, Any
from decimal import Decimal

# AWS Configuration
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
DYNAMODB_TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'Moose-DDB')

# Initialize DynamoDB client
try:
    dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
    table = dynamodb.Table(DYNAMODB_TABLE_NAME)
    print(f"Connected to DynamoDB table: {DYNAMODB_TABLE_NAME}")
except Exception as e:
    print(f"Failed to connect to DynamoDB: {str(e)}")
    exit(1)

def convert_decimals(obj):
    """Convert Decimal objects to appropriate Python types"""
    if isinstance(obj, list):
        return [convert_decimals(i) for i in obj]
    elif isinstance(obj, dict):
        return {k: convert_decimals(v) for k, v in obj.items()}
    elif isinstance(obj, Decimal):
        return float(obj)
    else:
        return obj

def scan_inverter_status():
    """Scan for all Inverter# entries with SK = STATUS"""
    print("\n" + "="*60)
    print("SCANNING INVERTER STATUS ENTRIES")
    print("="*60)
    
    inverter_statuses = []
    
    # Initial scan
    response = table.scan(
        FilterExpression='begins_with(PK, :pk_prefix) AND SK = :sk_value',
        ExpressionAttributeValues={
            ':pk_prefix': 'Inverter#',
            ':sk_value': 'STATUS'
        }
    )
    
    # Process the items
    inverter_statuses.extend(response['Items'])
    print(f"Found {len(response['Items'])} inverter status entries in first scan")
    
    # Handle pagination if there are more items
    while 'LastEvaluatedKey' in response:
        response = table.scan(
            ExclusiveStartKey=response['LastEvaluatedKey'],
            FilterExpression='begins_with(PK, :pk_prefix) AND SK = :sk_value',
            ExpressionAttributeValues={
                ':pk_prefix': 'Inverter#',
                ':sk_value': 'STATUS'
            }
        )
        inverter_statuses.extend(response['Items'])
        print(f"Found {len(response['Items'])} more inverter status entries in pagination")
    
    print(f"\nTotal Inverter Status Entries Found: {len(inverter_statuses)}")
    
    # Analyze inverter statuses and collect unique pvSystemIds
    status_counter = Counter()
    unique_pv_system_ids = set()
    
    for item in inverter_statuses:
        inverter_id = item['PK'].replace('Inverter#', '')
        status = item.get('status', 'unknown')
        status_counter[status] += 1
        
        # Collect unique pvSystemId
        pv_system_id = item.get('pvSystemId', '')
        if pv_system_id:
            unique_pv_system_ids.add(pv_system_id)
        
        print(f"Inverter {inverter_id}: {status} (System: {pv_system_id})")
    
    # Print inverter statistics
    print(f"\n" + "-"*40)
    print("INVERTER STATUS SUMMARY:")
    print("-"*40)
    for status, count in status_counter.most_common():
        print(f"{status.upper()}: {count}")
    print(f"TOTAL INVERTERS: {sum(status_counter.values())}")
    print(f"UNIQUE PV SYSTEM IDS: {len(unique_pv_system_ids)}")
    
    return inverter_statuses, status_counter, unique_pv_system_ids

def scan_system_status():
    """Scan for all System# entries with SK = STATUS"""
    print("\n" + "="*60)
    print("SCANNING SYSTEM STATUS ENTRIES")
    print("="*60)
    
    system_statuses = []
    
    # Initial scan
    response = table.scan(
        FilterExpression='begins_with(PK, :pk_prefix) AND SK = :sk_value',
        ExpressionAttributeValues={
            ':pk_prefix': 'System#',
            ':sk_value': 'STATUS'
        }
    )
    
    # Process the items
    system_statuses.extend(response['Items'])
    print(f"Found {len(response['Items'])} system status entries in first scan")
    
    # Handle pagination if there are more items
    while 'LastEvaluatedKey' in response:
        response = table.scan(
            ExclusiveStartKey=response['LastEvaluatedKey'],
            FilterExpression='begins_with(PK, :pk_prefix) AND SK = :sk_value',
            ExpressionAttributeValues={
                ':pk_prefix': 'System#',
                ':sk_value': 'STATUS'
            }
        )
        system_statuses.extend(response['Items'])
        print(f"Found {len(response['Items'])} more system status entries in pagination")
    
    print(f"\nTotal System Status Entries Found: {len(system_statuses)}")
    
    # Analyze system statuses
    total_green_inverters = 0
    total_red_inverters = 0
    total_moon_inverters = 0
    total_offline_inverters = 0
    system_overall_status_counter = Counter()
    
    for item in system_statuses:
        system_id = item['PK'].replace('System#', '')
        
        # Convert decimals to regular numbers
        item_converted = convert_decimals(item)
        
        # Get inverter counts
        green_inverters = len(item_converted.get('GreenInverters', []))
        red_inverters = len(item_converted.get('RedInverters', []))
        moon_inverters = len(item_converted.get('MoonInverters', []))
        offline_inverters = len(item_converted.get('OfflineInverters', []))
        
        # Get overall system status
        overall_status = item_converted.get('status', 'unknown')
        system_overall_status_counter[overall_status] += 1
        
        # Add to totals
        total_green_inverters += green_inverters
        total_red_inverters += red_inverters
        total_moon_inverters += moon_inverters
        total_offline_inverters += offline_inverters
        
        print(f"System {system_id}:")
        print(f"  Overall Status: {overall_status}")
        print(f"  Green Inverters: {green_inverters}")
        print(f"  Red Inverters: {red_inverters}")
        print(f"  Moon Inverters: {moon_inverters}")
        print(f"  Offline Inverters: {offline_inverters}")
        print(f"  Total Inverters: {green_inverters + red_inverters + moon_inverters + offline_inverters}")
        print()
    
    # Print system statistics
    print(f"\n" + "-"*40)
    print("SYSTEM STATUS SUMMARY:")
    print("-"*40)
    print(f"TOTAL GREEN INVERTERS: {total_green_inverters}")
    print(f"TOTAL RED INVERTERS: {total_red_inverters}")
    print(f"TOTAL MOON INVERTERS: {total_moon_inverters}")
    print(f"TOTAL OFFLINE INVERTERS: {total_offline_inverters}")
    print(f"TOTAL INVERTERS (from systems): {total_green_inverters + total_red_inverters + total_moon_inverters + total_offline_inverters}")
    print()
    print("SYSTEM OVERALL STATUS DISTRIBUTION:")
    for status, count in system_overall_status_counter.most_common():
        print(f"{status.upper()} SYSTEMS: {count}")
    print(f"TOTAL SYSTEMS: {sum(system_overall_status_counter.values())}")
    
    return system_statuses, {
        'total_green_inverters': total_green_inverters,
        'total_red_inverters': total_red_inverters,
        'total_moon_inverters': total_moon_inverters,
        'total_offline_inverters': total_offline_inverters,
        'system_status_distribution': system_overall_status_counter
    }

def main():
    """Main function to run the status scanning"""
    print("🔍 SOLAR SYSTEM STATUS SCANNER")
    print("="*60)
    
    try:
        # Scan inverter statuses
        inverter_data, inverter_stats, unique_pv_system_ids = scan_inverter_status()
        
        # Scan system statuses
        system_data, system_stats = scan_system_status()
        
        # Print overall summary
        print("\n" + "="*60)
        print("OVERALL SUMMARY")
        print("="*60)
        print(f"Total Individual Inverter Status Entries: {len(inverter_data)}")
        print(f"Total System Status Entries: {len(system_data)}")
        print(f"Unique PV System IDs (from inverters): {len(unique_pv_system_ids)}")
        print()
        
        if inverter_stats:
            print("Individual Inverter Status Distribution:")
            for status, count in inverter_stats.most_common():
                print(f"  {status.upper()}: {count}")
        
        print()
        print("Inverters Aggregated by Systems:")
        print(f"  GREEN: {system_stats['total_green_inverters']}")
        print(f"  RED: {system_stats['total_red_inverters']}")
        print(f"  MOON: {system_stats['total_moon_inverters']}")
        print(f"  OFFLINE: {system_stats['total_offline_inverters']}")
        
        print()
        print("System Overall Status Distribution:")
        for status, count in system_stats['system_status_distribution'].most_common():
            print(f"  {status.upper()}: {count}")
        
        print("\n✅ Status scanning completed successfully!")
        
    except Exception as e:
        print(f"❌ Error during status scanning: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main() 
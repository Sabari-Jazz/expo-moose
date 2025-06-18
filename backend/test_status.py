"""
Test System Status Script

This script scans all system status records in DynamoDB and provides a comprehensive
breakdown of system statuses and inverter counts.

Key Features:
- Scans all systems with PK = System# and SK = STATUS  
- Counts systems by status (green, red, offline)
- Counts total inverters by status across all systems
- Provides detailed breakdown per system
- Returns comprehensive statistics

Usage:
    python test_status.py
"""

import os
import json
import logging
import boto3
from datetime import datetime
from typing import Dict, List, Any
import botocore.config

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('test_status')

# AWS Configuration
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
DYNAMODB_TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'Moose-DDB')

# Configure DynamoDB
dynamodb_config = botocore.config.Config(
    max_pool_connections=50
)
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION, config=dynamodb_config)
table = dynamodb.Table(DYNAMODB_TABLE_NAME)

def get_all_system_statuses() -> List[Dict[str, Any]]:
    """Get all system status records from DynamoDB"""
    try:
        logger.info("Scanning DynamoDB for all system status records...")
        
        # Scan for all system status records
        response = table.scan(
            FilterExpression=boto3.dynamodb.conditions.Attr('PK').begins_with('System#') & 
                           boto3.dynamodb.conditions.Attr('SK').eq('STATUS')
        )
        
        systems = response.get('Items', [])
        logger.info(f"Found {len(systems)} system status records")
        
        return systems
        
    except Exception as e:
        logger.error(f"Error scanning system status records: {str(e)}")
        return []

def analyze_system_statuses(systems: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Analyze and count system statuses"""
    
    # Initialize counters
    system_counts = {
        'green': 0,
        'red': 0, 
        'offline': 0,
        'unknown': 0
    }
    
    inverter_counts = {
        'green': 0,
        'red': 0,
        'offline': 0
    }
    
    system_details = []
    total_systems = len(systems)
    total_inverters = 0
    
    logger.info("Analyzing system statuses...")
    
    for system in systems:
        # Extract system information
        system_id = system.get('pvSystemId', 'Unknown')
        system_status = system.get('status', 'unknown')
        green_inverters = system.get('GreenInverters', []) or []
        red_inverters = system.get('RedInverters', []) or []
        offline_inverters = system.get('OfflineInverters', []) or []
        last_updated = system.get('lastUpdated', 'Never')
        
        # Count inverters
        green_count = len(green_inverters)
        red_count = len(red_inverters)
        offline_count = len(offline_inverters)
        system_total = green_count + red_count + offline_count
        
        # Update system status counts
        if system_status in system_counts:
            system_counts[system_status] += 1
        else:
            system_counts['unknown'] += 1
        
        # Update inverter counts
        inverter_counts['green'] += green_count
        inverter_counts['red'] += red_count
        inverter_counts['offline'] += offline_count
        total_inverters += system_total
        
        # Store system details
        system_detail = {
            'systemId': system_id,
            'status': system_status,
            'inverters': {
                'green': green_count,
                'red': red_count,
                'offline': offline_count,
                'total': system_total
            },
            'lastUpdated': last_updated
        }
        system_details.append(system_detail)
        
        # Log system info
        status_emoji = {"green": "✅", "red": "🔴", "offline": "🔌", "unknown": "❓"}.get(system_status, "❓")
        logger.info(f"{status_emoji} System {system_id}: {system_status.upper()} "
                   f"(G:{green_count}, R:{red_count}, O:{offline_count})")
    
    return {
        'summary': {
            'total_systems': total_systems,
            'total_inverters': total_inverters,
            'systems_by_status': system_counts,
            'inverters_by_status': inverter_counts,
            'scan_timestamp': datetime.utcnow().isoformat()
        },
        'system_details': system_details
    }

def print_summary_report(analysis: Dict[str, Any]) -> None:
    """Print a formatted summary report"""
    summary = analysis['summary']
    
    print("\n" + "="*60)
    print("🔍 SYSTEM STATUS ANALYSIS REPORT")
    print("="*60)
    
    # Overall statistics
    print(f"\n📊 OVERALL STATISTICS:")
    print(f"   Total Systems: {summary['total_systems']}")
    print(f"   Total Inverters: {summary['total_inverters']}")
    print(f"   Scan Time: {summary['scan_timestamp']}")
    
    # System status breakdown
    print(f"\n🏢 SYSTEMS BY STATUS:")
    system_counts = summary['systems_by_status']
    for status, count in system_counts.items():
        if count > 0:
            emoji = {"green": "✅", "red": "🔴", "offline": "🔌", "unknown": "❓"}.get(status, "❓")
            percentage = (count / summary['total_systems'] * 100) if summary['total_systems'] > 0 else 0
            print(f"   {emoji} {status.capitalize()}: {count} systems ({percentage:.1f}%)")
    
    # Inverter status breakdown
    print(f"\n⚡ INVERTERS BY STATUS:")
    inverter_counts = summary['inverters_by_status']
    for status, count in inverter_counts.items():
        if count > 0:
            emoji = {"green": "✅", "red": "🔴", "offline": "🔌"}.get(status, "❓")
            percentage = (count / summary['total_inverters'] * 100) if summary['total_inverters'] > 0 else 0
            print(f"   {emoji} {status.capitalize()}: {count} inverters ({percentage:.1f}%)")
    
    # System health summary
    print(f"\n🏥 SYSTEM HEALTH SUMMARY:")
    if system_counts['green'] == summary['total_systems']:
        print("   🎉 All systems are GREEN - Perfect health!")
    elif system_counts['red'] > 0:
        print(f"   ⚠️  {system_counts['red']} systems need attention (RED status)")
    elif system_counts['offline'] > 0:
        print(f"   🔌 {system_counts['offline']} systems are offline")
    
    print("\n" + "="*60)

def main():
    """Main function to test system statuses"""
    try:
        logger.info("=== STARTING SYSTEM STATUS TEST ===")
        
        # Get all system status records
        systems = get_all_system_statuses()
        
        if not systems:
            logger.warning("No system status records found!")
            return {
                'error': 'No system status records found',
                'summary': {
                    'total_systems': 0,
                    'total_inverters': 0,
                    'systems_by_status': {'green': 0, 'red': 0, 'offline': 0, 'unknown': 0},
                    'inverters_by_status': {'green': 0, 'red': 0, 'offline': 0}
                }
            }
        
        # Analyze the systems
        analysis = analyze_system_statuses(systems)
        
        # Print formatted report
        print_summary_report(analysis)
        
        # Save detailed results to file
        output_file = f"system_status_report_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
        with open(output_file, 'w') as f:
            json.dump(analysis, f, indent=2, default=str)
        
        logger.info(f"✅ Detailed report saved to: {output_file}")
        logger.info("=== SYSTEM STATUS TEST COMPLETED ===")
        
        return analysis
        
    except Exception as e:
        logger.error(f"Error in main function: {str(e)}")
        return {'error': str(e)}

if __name__ == "__main__":
    result = main()
    
    # Print final summary for easy reading
    if 'summary' in result:
        summary = result['summary']
        print(f"\n🎯 QUICK SUMMARY:")
        print(f"   Systems: {summary['systems_by_status']['green']} Green, "
              f"{summary['systems_by_status']['red']} Red, "
              f"{summary['systems_by_status']['offline']} Offline")
        print(f"   Inverters: {summary['inverters_by_status']['green']} Green, "
              f"{summary['inverters_by_status']['red']} Red, "
              f"{summary['inverters_by_status']['offline']} Offline") 
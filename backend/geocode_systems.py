"""
Geocode System Locations Script

This script scans all system profiles in DynamoDB and geocodes their addresses
using Google Maps Geocoding API, then stores the coordinates back in the database.

Key Features:
- Scans all systems with PK = System#<SystemId> and SK = PROFILE
- Extracts address information from each profile
- Uses Google Maps Geocoding API to get coordinates
- Updates profiles with geocoded coordinates (gpsData.latitude/longitude)
- Handles caching and error cases
- Skips systems that already have coordinates

Environment Variables Required:
- GOOGLE_MAPS_API_KEY: Your Google Maps API key
- AWS_REGION: AWS region (default: us-east-1)
- DYNAMODB_TABLE_NAME: DynamoDB table name (default: Moose-DDB)

Usage:
    python geocode_systems.py
"""

import os
import json
import logging
import boto3
import requests
import time
from datetime import datetime
from typing import Dict, List, Any, Optional, Tuple
from decimal import Decimal
import botocore.config

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('geocode_systems')

# Configuration
GOOGLE_MAPS_API_KEY = 'AIzaSyAuPGCtp8TU9L68SML44Ot2rzlKdi-A-SU'
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')
DYNAMODB_TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'Moose-DDB')

# Validate required environment variables
if not GOOGLE_MAPS_API_KEY:
    logger.error("GOOGLE_MAPS_API_KEY environment variable is required!")
    exit(1)

# Configure DynamoDB
dynamodb_config = botocore.config.Config(
    max_pool_connections=50,
    retries={'max_attempts': 3}
)
dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION, config=dynamodb_config)
table = dynamodb.Table(DYNAMODB_TABLE_NAME)

def get_all_system_profiles() -> List[Dict[str, Any]]:
    """Get all system profile records from DynamoDB"""
    try:
        logger.info("Scanning DynamoDB for all system profile records...")
        
        # Scan for all system profile records
        response = table.scan(
            FilterExpression=boto3.dynamodb.conditions.Attr('PK').begins_with('System#') & 
                           boto3.dynamodb.conditions.Attr('SK').eq('PROFILE')
        )
        
        profiles = response.get('Items', [])
        logger.info(f"Found {len(profiles)} system profile records")
        
        return profiles
        
    except Exception as e:
        logger.error(f"Error scanning system profile records: {str(e)}")
        return []

def has_valid_coordinates(profile: Dict[str, Any]) -> bool:
    """Check if profile already has valid GPS coordinates"""
    try:
        gps_data = profile.get('gpsData', {})
        if isinstance(gps_data, dict):
            lat = gps_data.get('latitude')
            lng = gps_data.get('longitude')
            
            # Check if coordinates are valid numbers
            if (isinstance(lat, (int, float, Decimal)) and isinstance(lng, (int, float, Decimal)) and
                -90 <= float(lat) <= 90 and -180 <= float(lng) <= 180):
                return True
        
        return False
        
    except Exception as e:
        logger.error(f"Error checking coordinates for profile: {str(e)}")
        return False

def format_address_from_profile(profile: Dict[str, Any]) -> Optional[str]:
    """Format address string from profile data"""
    try:
        address_parts = []
        
        # Get address components - safely handle None values
        street = profile.get('street') or ''
        city = profile.get('city') or ''
        state = profile.get('state') or ''
        zip_code = profile.get('zipCode') or ''
        country = profile.get('country') or ''
        
        # Strip whitespace only if the value is not empty
        street = street.strip() if street else ''
        city = city.strip() if city else ''
        state = state.strip() if state else ''
        zip_code = zip_code.strip() if zip_code else ''
        country = country.strip() if country else ''
        
        # Build address string
        if street:
            address_parts.append(street)
        if city:
            address_parts.append(city)
        if state and zip_code:
            address_parts.append(f"{state} {zip_code}")
        elif state:
            address_parts.append(state)
        elif zip_code:
            address_parts.append(zip_code)
        if country:
            address_parts.append(country)
        
        if not address_parts:
            return None
            
        formatted_address = ', '.join(address_parts)
        logger.debug(f"Formatted address: {formatted_address}")
        return formatted_address
        
    except Exception as e:
        logger.error(f"Error formatting address from profile: {str(e)}")
        return None

def geocode_address(address: str, max_retries: int = 3) -> Optional[Tuple[float, float]]:
    """Geocode an address using Google Maps Geocoding API"""
    if not address or not address.strip():
        return None
    
    url = "https://maps.googleapis.com/maps/api/geocode/json"
    
    for attempt in range(max_retries):
        try:
            logger.info(f"Geocoding attempt {attempt + 1}/{max_retries} for: {address}")
            
            params = {
                'address': address,
                'key': GOOGLE_MAPS_API_KEY
            }
            
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            
            if data['status'] == 'OK' and data['results']:
                location = data['results'][0]['geometry']['location']
                lat = location['lat']
                lng = location['lng']
                
                logger.info(f"✅ Successfully geocoded: {address} → ({lat}, {lng})")
                return (lat, lng)
            
            elif data['status'] == 'ZERO_RESULTS':
                logger.warning(f"No results found for address: {address}")
                return None
            
            elif data['status'] == 'OVER_QUERY_LIMIT':
                logger.warning(f"Query limit exceeded, waiting before retry...")
                time.sleep(2 ** attempt)  # Exponential backoff
                continue
            
            else:
                logger.warning(f"Geocoding API returned status: {data['status']} for address: {address}")
                return None
                
        except requests.exceptions.RequestException as e:
            logger.error(f"Request error on attempt {attempt + 1}: {str(e)}")
            if attempt < max_retries - 1:
                time.sleep(1)
                continue
            else:
                logger.error(f"Failed to geocode after {max_retries} attempts: {address}")
                return None
        
        except Exception as e:
            logger.error(f"Unexpected error geocoding {address}: {str(e)}")
            return None
    
    return None

def update_profile_coordinates(system_id: str, latitude: float, longitude: float) -> bool:
    """Update system profile with geocoded coordinates"""
    try:
        # Convert to Decimal for DynamoDB
        lat_decimal = Decimal(str(latitude))
        lng_decimal = Decimal(str(longitude))
        
        # Update the profile with GPS data
        response = table.update_item(
            Key={
                'PK': f'System#{system_id}',
                'SK': 'PROFILE'
            },
            UpdateExpression='SET gpsData = :gps_data, lastGeocoded = :timestamp',
            ExpressionAttributeValues={
                ':gps_data': {
                    'latitude': lat_decimal,
                    'longitude': lng_decimal
                },
                ':timestamp': datetime.utcnow().isoformat()
            },
            ReturnValues='UPDATED_NEW'
        )
        
        logger.info(f"✅ Updated coordinates for system {system_id}: ({latitude}, {longitude})")
        return True
        
    except Exception as e:
        logger.error(f"❌ Error updating coordinates for system {system_id}: {str(e)}")
        return False

def process_system_profile(profile: Dict[str, Any]) -> Dict[str, Any]:
    """Process a single system profile for geocoding"""
    # Extract system ID from PK
    system_id = profile['PK'].replace('System#', '')
    system_name = profile.get('name', f'System {system_id}')
    
    result = {
        'system_id': system_id,
        'system_name': system_name,
        'status': 'pending',
        'coordinates': None,
        'error': None
    }
    
    try:
        logger.info(f"\n=== Processing System: {system_name} ({system_id}) ===")
        
        # Check if system already has valid coordinates
        if has_valid_coordinates(profile):
            logger.info(f"✅ System {system_name} already has valid coordinates, skipping")
            result['status'] = 'skipped_has_coords'
            gps_data = profile.get('gpsData', {})
            result['coordinates'] = (float(gps_data.get('latitude', 0)), float(gps_data.get('longitude', 0)))
            return result
        
        # Format address from profile
        address = format_address_from_profile(profile)
        if not address:
            logger.warning(f"⚠️  No valid address found for system {system_name}")
            result['status'] = 'skipped_no_address'
            result['error'] = 'No valid address components found'
            return result
        
        logger.info(f"📍 Geocoding address: {address}")
        
        # Geocode the address
        coordinates = geocode_address(address)
        if not coordinates:
            logger.error(f"❌ Failed to geocode address for system {system_name}")
            result['status'] = 'failed_geocoding'
            result['error'] = 'Geocoding API failed to return coordinates'
            return result
        
        lat, lng = coordinates
        result['coordinates'] = (lat, lng)
        
        # Update the profile in database
        if update_profile_coordinates(system_id, lat, lng):
            result['status'] = 'success'
            logger.info(f"🎉 Successfully processed system {system_name}")
        else:
            result['status'] = 'failed_update'
            result['error'] = 'Failed to update database'
        
        return result
        
    except Exception as e:
        logger.error(f"❌ Error processing system {system_name}: {str(e)}")
        result['status'] = 'error'
        result['error'] = str(e)
        return result

def generate_summary_report(results: List[Dict[str, Any]]) -> None:
    """Generate and display summary report"""
    
    # Count results by status
    status_counts = {
        'success': 0,
        'skipped_has_coords': 0,
        'skipped_no_address': 0,
        'failed_geocoding': 0,
        'failed_update': 0,
        'error': 0
    }
    
    for result in results:
        status = result.get('status', 'error')
        if status in status_counts:
            status_counts[status] += 1
        else:
            status_counts['error'] += 1
    
    total_systems = len(results)
    successful = status_counts['success']
    skipped = status_counts['skipped_has_coords'] + status_counts['skipped_no_address']
    failed = total_systems - successful - skipped
    
    print("\n" + "="*70)
    print("🌍 GEOCODING SUMMARY REPORT")
    print("="*70)
    
    print(f"\n📊 OVERALL STATISTICS:")
    print(f"   Total Systems Processed: {total_systems}")
    print(f"   Successfully Geocoded: {successful}")
    print(f"   Skipped (Already Had Coords): {status_counts['skipped_has_coords']}")
    print(f"   Skipped (No Address): {status_counts['skipped_no_address']}")
    print(f"   Failed: {failed}")
    
    print(f"\n📈 SUCCESS RATE:")
    if total_systems > 0:
        success_rate = (successful / total_systems) * 100
        print(f"   {success_rate:.1f}% of systems successfully geocoded")
    
    print(f"\n📋 DETAILED BREAKDOWN:")
    for status, count in status_counts.items():
        if count > 0:
            emoji_map = {
                'success': '✅',
                'skipped_has_coords': '⏭️',
                'skipped_no_address': '⚠️',
                'failed_geocoding': '🌐❌',
                'failed_update': '💾❌',
                'error': '❌'
            }
            emoji = emoji_map.get(status, '❓')
            status_name = status.replace('_', ' ').title()
            print(f"   {emoji} {status_name}: {count}")
    
    # Show failed systems
    failed_systems = [r for r in results if r['status'] not in ['success', 'skipped_has_coords']]
    if failed_systems:
        print(f"\n⚠️  SYSTEMS NEEDING ATTENTION:")
        for result in failed_systems[:10]:  # Show first 10
            print(f"   • {result['system_name']} ({result['system_id']}): {result['status']}")
            if result.get('error'):
                print(f"     Error: {result['error']}")
        
        if len(failed_systems) > 10:
            print(f"   ... and {len(failed_systems) - 10} more")
    
    print("\n" + "="*70)

def main():
    """Main function to geocode all system profiles"""
    start_time = time.time()
    
    try:
        logger.info("=== STARTING SYSTEM GEOCODING PROCESS ===")
        logger.info(f"Google Maps API Key: {'✅ Configured' if GOOGLE_MAPS_API_KEY else '❌ Missing'}")
        logger.info(f"DynamoDB Table: {DYNAMODB_TABLE_NAME}")
        logger.info(f"AWS Region: {AWS_REGION}")
        
        # Get all system profiles
        profiles = get_all_system_profiles()
        
        if not profiles:
            logger.warning("No system profiles found in database!")
            return
        
        logger.info(f"Found {len(profiles)} system profiles to process")
        
        # Process each profile
        results = []
        for i, profile in enumerate(profiles, 1):
            logger.info(f"\n--- Processing {i}/{len(profiles)} ---")
            result = process_system_profile(profile)
            results.append(result)
            
            # Add small delay to respect API rate limits
            time.sleep(0.1)
        
        # Generate summary report
        generate_summary_report(results)
        
        # Save detailed results to file
        output_file = f"geocoding_results_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
        with open(output_file, 'w') as f:
            json.dump(results, f, indent=2, default=str)
        
        end_time = time.time()
        duration = end_time - start_time
        
        logger.info(f"\n✅ Geocoding process completed in {duration:.1f} seconds")
        logger.info(f"📄 Detailed results saved to: {output_file}")
        
    except Exception as e:
        logger.error(f"❌ Critical error in main process: {str(e)}")
        return 1
    
    return 0

if __name__ == "__main__":
    exit(main()) 
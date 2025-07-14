"""
Solar Data Lambda Function  
Handles: /api/systems/*
Direct split from app.py with NO logic changes
"""

import os
import json
import boto3
import requests
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Dict, List, Optional, Any, Union
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from mangum import Mangum
import logging
from urllib.parse import urlencode

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# AWS Configuration
AWS_REGION = os.environ.get('AWS_REGION_', 'us-east-1')
DYNAMODB_TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'Moose-DDB')

# Initialize DynamoDB client
try:
    dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
    table = dynamodb.Table(DYNAMODB_TABLE_NAME)
    print(f"Connected to DynamoDB table: {DYNAMODB_TABLE_NAME}")
except Exception as e:
    print(f"Failed to connect to DynamoDB: {str(e)}")
    dynamodb = None
    table = None

# Create FastAPI app
app = FastAPI(
    title="Solar Data Service",
    description="Solar system data endpoints",
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
# Helper Functions - EXACT COPIES from app.py
#---------------------------------------

def get_consolidated_period_data(system_id: str, period_type: str, period_key: str = None) -> Dict[str, Any]:
    """
    Get consolidated period data (weekly, monthly, yearly) for a specific system
    """
    if not table:
        raise HTTPException(status_code=503, detail="Database not available")
    
    try:
        if period_key is None:
            # Get the most recent entry for this period type
            response = table.query(
                IndexName='SystemDateIndex',
                KeyConditionExpression=boto3.dynamodb.conditions.Key('PK').eq(f'System#{system_id}') & 
                                     boto3.dynamodb.conditions.Key('SK').begins_with(f'DATA#{period_type.upper()}#'),
                ScanIndexForward=False,  # Get most recent first
                Limit=1
            )
        else:
            # Get specific period
            sk_value = f'DATA#{period_type.upper()}#{period_key}'
            response = table.get_item(
                Key={
                    'PK': f'System#{system_id}',
                    'SK': sk_value
                }
            )
            
            if 'Item' in response:
                response = {'Items': [response['Item']]}
            else:
                response = {'Items': []}
        
        if not response['Items']:
            return {"error": f"No {period_type} data found for system {system_id}"}
        
        item = response['Items'][0]
        
        # Convert Decimal types to float for JSON serialization
        def convert_decimals(obj):
            if isinstance(obj, dict):
                return {k: convert_decimals(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_decimals(v) for v in obj]
            elif isinstance(obj, Decimal):
                return float(obj)
            return obj
        
        result = convert_decimals(item)
        return result
        
    except Exception as e:
        logger.error(f"Error getting consolidated {period_type} data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get {period_type} data")


# CONSOLIDATED API ENDPOINTS
@app.get("/api/systems/{system_id}/consolidated-daily")
async def get_system_consolidated_daily_data(
    system_id: str,
    date: str = None
):
    """
    API endpoint to get consolidated daily data (energy, power, CO2, earnings) from DynamoDB
    """
    logger.info(f"=== API ENDPOINT: /api/systems/{system_id}/consolidated-daily ===")
    logger.info(f"Parameters - system_id: {system_id}, date: {date}")
    
    try:
        if not date:
            date = datetime.utcnow().strftime("%Y-%m-%d")
            logger.info(f"No date provided, using current date: {date}")
            
        data = get_consolidated_period_data(system_id, "DAILY", date)
        logger.info(f"API endpoint result: {data}")
        
        if "error" in data:
            logger.error(f"Raising HTTPException 500: {data['error']}")
            raise HTTPException(status_code=500, detail=data["error"])
        return data
    except HTTPException as he:
        logger.error(f"HTTPException raised: {he.status_code} - {he.detail}")
        raise
    except Exception as e:
        logger.error(f"Unexpected exception in API endpoint: {str(e)}")
        import traceback
        logger.error(f"Endpoint traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/systems/{system_id}/consolidated-weekly")
async def get_system_consolidated_weekly_data(
    system_id: str,
    week_start: str = None
):
    """
    API endpoint to get consolidated weekly data (energy, CO2, earnings) from DynamoDB
    """
    logger.info(f"=== API ENDPOINT: /api/systems/{system_id}/consolidated-weekly ===")
    logger.info(f"Parameters - system_id: {system_id}, week_start: {week_start}")
    
    try:
        data = get_consolidated_period_data(system_id, "WEEKLY", week_start)
        logger.info(f"API endpoint result: {data}")
        
        if "error" in data:
            logger.error(f"Raising HTTPException 500: {data['error']}")
            raise HTTPException(status_code=500, detail=data["error"])
        return data
    except HTTPException as he:
        logger.error(f"HTTPException raised: {he.status_code} - {he.detail}")
        raise
    except Exception as e:
        logger.error(f"Unexpected exception in API endpoint: {str(e)}")
        import traceback
        logger.error(f"Endpoint traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/systems/{system_id}/consolidated-monthly")
async def get_system_consolidated_monthly_data(
    system_id: str,
    month: str = None
):
    """
    API endpoint to get consolidated monthly data (energy, CO2, earnings) from DynamoDB
    """
    try:
        data = get_consolidated_period_data(system_id, "MONTHLY", month)
        if "error" in data:
            raise HTTPException(status_code=500, detail=data["error"])
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/systems/{system_id}/consolidated-yearly")
async def get_system_consolidated_yearly_data(
    system_id: str,
    year: str = None
):
    """
    API endpoint to get consolidated yearly data (energy, CO2, earnings) from DynamoDB
    """
    try:
        data = get_consolidated_period_data(system_id, "YEARLY", year)
        if "error" in data:
            raise HTTPException(status_code=500, detail=data["error"])
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/systems/{system_id}/profile")
async def get_system_profile_data(system_id: str):
    """
    API endpoint to get system profile data from DynamoDB
    """
    logger.info(f"=== API ENDPOINT: /api/systems/{system_id}/profile ===")
    logger.info(f"Parameters - system_id: {system_id}")
    
    if not table:
        raise HTTPException(status_code=503, detail="Database not available")
    
    try:
        # Query DynamoDB for system profile
        response = table.get_item(
            Key={
                'PK': f'System#{system_id}',
                'SK': 'PROFILE'
            }
        )
        
        if 'Item' not in response:
            logger.warning(f"No profile found for system {system_id}")
            raise HTTPException(status_code=404, detail=f"System profile not found for {system_id}")
        
        item = response['Item']
        
        # Convert Decimal types to float for JSON serialization
        def convert_decimals(obj):
            if isinstance(obj, dict):
                return {k: convert_decimals(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_decimals(v) for v in obj]
            elif isinstance(obj, Decimal):
                return float(obj)
            return obj
        
        profile_data = convert_decimals(item)
        logger.info(f"Successfully retrieved profile for system {system_id}")
        
        return profile_data
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting system profile for {system_id}: {str(e)}")
        import traceback
        logger.error(f"Profile endpoint traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/systems/{system_id}/status")
async def get_system_status(system_id: str):
    """
    API endpoint to get system status from DynamoDB
    """
    logger.info(f"=== API ENDPOINT: /api/systems/{system_id}/status ===")
    logger.info(f"Parameters - system_id: {system_id}")
    
    if not table:
        raise HTTPException(status_code=503, detail="Database not available")
    
    try:
        # Query DynamoDB for system status
        response = table.get_item(
            Key={
                'PK': f'System#{system_id}',
                'SK': 'STATUS'
            }
        )
        
        if 'Item' not in response:
            logger.warning(f"No status found for system {system_id}")
            # Return default status if no record found
            return {
                "status": "offline",
                "message": "No status data available"
            }
        
        item = response['Item']
        
        # Convert Decimal types to appropriate types for JSON serialization
        def convert_decimals(obj):
            if isinstance(obj, dict):
                return {k: convert_decimals(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_decimals(v) for v in obj]
            elif isinstance(obj, Decimal):
                return float(obj)
            return obj
        
        status_data = convert_decimals(item)
        logger.info(f"Successfully retrieved status for system {system_id}: {status_data.get('status', 'unknown')}")
        
        return status_data
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting system status for {system_id}: {str(e)}")
        import traceback
        logger.error(f"Status endpoint traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/systems/{system_id}/expected-earnings")
async def get_system_expected_earnings(system_id: str):
    """
    API endpoint to get expected earnings based on last 3 days average
    Returns averages of production, earnings, and CO2 from last 3 days (excluding today)
    """
    logger.info(f"=== API ENDPOINT: /api/systems/{system_id}/expected-earnings ===")
    
    if not table:
        raise HTTPException(status_code=503, detail="Database not available")
    
    try:
        # Get last 3 days (excluding today)
        today = datetime.utcnow().date()
        dates_to_check = []
        for i in range(1, 4):  # 1, 2, 3 days ago
            date = today - timedelta(days=i)
            dates_to_check.append(date.strftime("%Y-%m-%d"))
        
        logger.info(f"Checking dates: {dates_to_check}")
        
        # Fetch data for each date
        daily_data = []
        for date_str in dates_to_check:
            try:
                response = table.get_item(
                    Key={
                        'PK': f'System#{system_id}',
                        'SK': f'DATA#DAILY#{date_str}'
                    }
                )
                
                if 'Item' in response:
                    item = response['Item']
                    # Convert Decimals to float for calculations
                    daily_data.append({
                        'date': date_str,
                        'energyProductionWh': float(item.get('energyProductionWh', 0)),
                        'earnings': float(item.get('earnings', 0)),
                        'co2Savings': float(item.get('co2Savings', 0))
                    })
                    logger.info(f"Found data for {date_str}")
                else:
                    logger.info(f"No data found for {date_str}")
            except Exception as e:
                logger.warning(f"Error fetching data for {date_str}: {str(e)}")
        
        if not daily_data:
            logger.warning(f"No historical data found for system {system_id}")
            # Return zeros if no data available
            return {
                "production_avg": 0.0,
                "earnings_avg": 0.0,
                "co2_avg": 0.0,
                "days_used": 0
            }
        
        # Calculate averages
        total_production = sum(item['energyProductionWh'] for item in daily_data)
        total_earnings = sum(item['earnings'] for item in daily_data)
        total_co2 = sum(item['co2Savings'] for item in daily_data)
        
        days_count = len(daily_data)
        
        result = {
            "production_avg": round(total_production / days_count, 2),
            "earnings_avg": round(total_earnings / days_count, 2),
            "co2_avg": round(total_co2 / days_count, 2),
            "days_used": days_count
        }
        
        logger.info(f"Expected earnings result: {result}")
        return result
        
    except Exception as e:
        logger.error(f"Error calculating expected earnings for system {system_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to calculate expected earnings: {str(e)}")

@app.get("/api/systems/{system_id}/statusDetails")
async def get_system_status_details(system_id: str):
    """
    API endpoint to get detailed system status with inverter breakdown from DynamoDB
    """
    logger.info(f"=== API ENDPOINT: /api/systems/{system_id}/statusDetails ===")
    logger.info(f"Parameters - system_id: {system_id}")
    
    if not table:
        raise HTTPException(status_code=503, detail="Database not available")
    
    try:
        # Query DynamoDB for system status details
        response = table.get_item(
            Key={
                'PK': f'System#{system_id}',
                'SK': 'STATUS'
            }
        )
        
        if 'Item' not in response:
            logger.warning(f"No status details found for system {system_id}")
            raise HTTPException(status_code=404, detail=f"System status details not found for {system_id}")
        
        item = response['Item']
        
        # Convert Decimal types to appropriate types for JSON serialization
        def convert_decimals(obj):
            if isinstance(obj, dict):
                return {k: convert_decimals(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_decimals(v) for v in obj]
            elif isinstance(obj, Decimal):
                return float(obj)
            return obj
        
        status_details = convert_decimals(item)
        logger.info(f"Successfully retrieved status details for system {system_id}")
        
        return status_details
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting system status details for {system_id}: {str(e)}")
        import traceback
        logger.error(f"Status details endpoint traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

# Health check endpoint
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "solar-data",
        "timestamp": datetime.now().isoformat()
    }

# AWS Lambda handler
handler = Mangum(app) 
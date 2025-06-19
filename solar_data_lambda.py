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
    """EXACT COPY from app.py lines 2025-2080"""
    try:
        if not table:
            return {"error": "Database connection not available"}
        
        # Construct the sort key based on period type
        if period_key:
            sk = f"{period_type.upper()}#{period_key}"
        else:
            # Use current date if no period_key provided
            if period_type == "daily":
                sk = f"DAILY#{datetime.now().strftime('%Y-%m-%d')}"
            elif period_type == "weekly":
                # Use Monday of current week
                today = datetime.now()
                monday = today - timedelta(days=today.weekday())
                sk = f"WEEKLY#{monday.strftime('%Y-%m-%d')}"
            elif period_type == "monthly":
                sk = f"MONTHLY#{datetime.now().strftime('%Y-%m')}"
            elif period_type == "yearly":
                sk = f"YEARLY#{datetime.now().strftime('%Y')}"
            else:
                return {"error": f"Invalid period type: {period_type}"}
        
        response = table.get_item(
            Key={
                'PK': f'System#{system_id}',
                'SK': sk
            }
        )
        
        if 'Item' in response:
            data = response['Item']
            
            # Convert Decimal objects to float for JSON serialization
            def convert_decimals(obj):
                if isinstance(obj, list):
                    return [convert_decimals(i) for i in obj]
                elif isinstance(obj, dict):
                    return {k: convert_decimals(v) for k, v in obj.items()}
                elif isinstance(obj, Decimal):
                    return float(obj)
                else:
                    return obj
            
            return convert_decimals(data)
        else:
            return {"error": f"No {period_type} data found for system {system_id} and period {period_key or 'current'}"}
    except Exception as e:
        logger.error(f"Error getting consolidated {period_type} data: {str(e)}")
        return {"error": f"Failed to get {period_type} data: {str(e)}"}

#---------------------------------------
# API Endpoints - EXACT COPIES from app.py
#---------------------------------------

@app.get("/api/systems/{system_id}/consolidated-daily")
async def get_system_consolidated_daily_data(
    system_id: str,
    date: str = None
):
    """EXACT COPY from app.py lines 2081-2113"""
    try:
        # Use provided date or default to today
        if not date:
            date = datetime.now().strftime('%Y-%m-%d')
        
        data = get_consolidated_period_data(system_id, "daily", date)
        
        if "error" in data:
            raise HTTPException(status_code=404, detail=data["error"])
        
        return data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_system_consolidated_daily_data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get daily data: {str(e)}")

@app.get("/api/systems/{system_id}/consolidated-weekly")
async def get_system_consolidated_weekly_data(
    system_id: str,
    week_start: str = None
):
    """EXACT COPY from app.py lines 2114-2142"""
    try:
        # Use provided week_start or default to Monday of current week
        if not week_start:
            today = datetime.now()
            monday = today - timedelta(days=today.weekday())
            week_start = monday.strftime('%Y-%m-%d')
        
        data = get_consolidated_period_data(system_id, "weekly", week_start)
        
        if "error" in data:
            raise HTTPException(status_code=404, detail=data["error"])
        
        return data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_system_consolidated_weekly_data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get weekly data: {str(e)}")

@app.get("/api/systems/{system_id}/consolidated-monthly")
async def get_system_consolidated_monthly_data(
    system_id: str,
    month: str = None
):
    """EXACT COPY from app.py lines 2143-2159"""
    try:
        # Use provided month or default to current month
        if not month:
            month = datetime.now().strftime('%Y-%m')
        
        data = get_consolidated_period_data(system_id, "monthly", month)
        
        if "error" in data:
            raise HTTPException(status_code=404, detail=data["error"])
        
        return data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_system_consolidated_monthly_data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get monthly data: {str(e)}")

@app.get("/api/systems/{system_id}/consolidated-yearly")
async def get_system_consolidated_yearly_data(
    system_id: str,
    year: str = None
):
    """EXACT COPY from app.py lines 2160-2176"""
    try:
        # Use provided year or default to current year
        if not year:
            year = datetime.now().strftime('%Y')
        
        data = get_consolidated_period_data(system_id, "yearly", year)
        
        if "error" in data:
            raise HTTPException(status_code=404, detail=data["error"])
        
        return data
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_system_consolidated_yearly_data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get yearly data: {str(e)}")

@app.get("/api/systems/{system_id}/profile")
async def get_system_profile_data(system_id: str):
    """EXACT COPY from app.py lines 2177-2225"""
    try:
        if not table:
            raise HTTPException(status_code=500, detail="Database connection not available")
        
        response = table.get_item(
            Key={
                'PK': f'System#{system_id}',
                'SK': 'PROFILE'
            }
        )
        
        if 'Item' in response:
            profile = response['Item']
            
            # Convert Decimal objects to float for JSON serialization
            def convert_decimals(obj):
                if isinstance(obj, list):
                    return [convert_decimals(i) for i in obj]
                elif isinstance(obj, dict):
                    return {k: convert_decimals(v) for k, v in obj.items()}
                elif isinstance(obj, Decimal):
                    return float(obj)
                else:
                    return obj
            
            return convert_decimals(profile)
        else:
            raise HTTPException(status_code=404, detail=f"System profile not found for system {system_id}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_system_profile_data: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get system profile: {str(e)}")

@app.get("/api/systems/{system_id}/status")
async def get_system_status(system_id: str):
    """EXACT COPY from app.py lines 2226-2284"""
    try:
        if not table:
            raise HTTPException(status_code=500, detail="Database connection not available")
        
        response = table.get_item(
            Key={
                'PK': f'System#{system_id}',
                'SK': 'STATUS'
            }
        )
        
        if 'Item' in response:
            status = response['Item']
            
            # Convert Decimal objects to float for JSON serialization
            def convert_decimals(obj):
                if isinstance(obj, list):
                    return [convert_decimals(i) for i in obj]
                elif isinstance(obj, dict):
                    return {k: convert_decimals(v) for k, v in obj.items()}
                elif isinstance(obj, Decimal):
                    return float(obj)
                else:
                    return obj
            
            return convert_decimals(status)
        else:
            # Return default status if not found
            return {
                "PK": f"System#{system_id}",
                "SK": "STATUS",
                "status": "unknown",
                "last_updated": datetime.now().isoformat(),
                "message": "Status not available"
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_system_status: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get system status: {str(e)}")

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
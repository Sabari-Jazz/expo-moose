"""
User Management Lambda Function
Handles: /api/user/*, /api/device/*
Direct split from app.py with NO logic changes
"""

import os
import json
import boto3
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
    title="User Management Service",
    description="User and device management for solar O&M system",
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
# Pydantic Models - EXACT COPIES from app.py
#---------------------------------------

class DeviceRegistration(BaseModel):
    """Device registration for push notifications"""
    user_id: str = Field(description="User ID owning this device")
    device_id: str = Field(description="Unique device identifier")
    expo_push_token: str = Field(description="Expo push notification token")
    platform: str = Field(description="Device platform (ios, android)")

class DeviceResponse(BaseModel):
    """Response for device operations"""
    success: bool
    message: str
    device_id: Optional[str] = None

#---------------------------------------
# Helper Functions - EXACT COPIES from app.py
#---------------------------------------

def register_device_in_db(device_data: DeviceRegistration) -> DeviceResponse:
    """EXACT COPY from app.py lines 1879-1908"""
    try:
        if not table:
            return DeviceResponse(
                success=False, 
                message="Database connection not available"
            )
        
        # Store device registration in DynamoDB
        table.put_item(
            Item={
                'PK': f'USER#{device_data.user_id}',
                'SK': f'DEVICE#{device_data.device_id}',
                'expo_push_token': device_data.expo_push_token,
                'platform': device_data.platform,
                'registered_at': datetime.now().isoformat(),
                'device_type': 'mobile'
            }
        )
        
        return DeviceResponse(
            success=True,
            message="Device registered successfully",
            device_id=device_data.device_id
        )
    except Exception as e:
        logger.error(f"Error registering device: {str(e)}")
        return DeviceResponse(
            success=False,
            message=f"Failed to register device: {str(e)}"
        )

def delete_device_from_db(user_id: str, device_id: str) -> DeviceResponse:
    """EXACT COPY from app.py lines 1909-1935"""
    try:
        if not table:
            return DeviceResponse(
                success=False, 
                message="Database connection not available"
            )
        
        # Delete device registration from DynamoDB
        table.delete_item(
            Key={
                'PK': f'USER#{user_id}',
                'SK': f'DEVICE#{device_id}'
            }
        )
        
        return DeviceResponse(
            success=True,
            message="Device deleted successfully",
            device_id=device_id
        )
    except Exception as e:
        logger.error(f"Error deleting device: {str(e)}")
        return DeviceResponse(
            success=False,
            message=f"Failed to delete device: {str(e)}"
        )

def get_user_systems(user_id: str) -> List[str]:
    """EXACT COPY from app.py lines 1936-1992"""
    try:
        if not table:
            return []
        
        # Check if user is admin
        user_profile_response = table.get_item(
            Key={
                'PK': f'USER#{user_id}',
                'SK': 'PROFILE'
            }
        )
        
        is_admin = False
        if 'Item' in user_profile_response:
            user_profile = user_profile_response['Item']
            is_admin = user_profile.get('role', 'user') == 'admin'
        
        if is_admin:
            # Admin users can access all systems
            # Query all systems in the database
            response = table.scan(
                FilterExpression='begins_with(PK, :pk)',
                ExpressionAttributeValues={
                    ':pk': 'System#'
                }
            )
            
            systems = []
            for item in response.get('Items', []):
                system_id = item['PK'].replace('System#', '')
                if system_id not in systems:
                    systems.append(system_id)
            
            return systems
        else:
            # Regular users can only access systems they're linked to
            response = table.query(
                KeyConditionExpression='PK = :pk AND begins_with(SK, :sk)',
                ExpressionAttributeValues={
                    ':pk': f'USER#{user_id}',
                    ':sk': 'SYSTEM#'
                }
            )
            
            systems = []
            for item in response.get('Items', []):
                system_id = item['SK'].replace('SYSTEM#', '')
                systems.append(system_id)
            
            return systems
    except Exception as e:
        logger.error(f"Error getting user systems: {str(e)}")
        return []

def get_user_profile(user_id: str) -> Dict[str, Any]:
    """EXACT COPY from app.py lines 1993-2024"""
    try:
        if not table:
            return {"error": "Database connection not available"}
        
        response = table.get_item(
            Key={
                'PK': f'USER#{user_id}',
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
            return {"error": "User profile not found"}
    except Exception as e:
        logger.error(f"Error getting user profile: {str(e)}")
        return {"error": f"Failed to get user profile: {str(e)}"}

#---------------------------------------
# API Endpoints - EXACT COPIES from app.py
#---------------------------------------

@app.get("/api/user/{user_id}/profile")
async def get_user_profile_endpoint(user_id: str):
    """EXACT COPY from app.py lines 2285-2306"""
    try:
        profile = get_user_profile(user_id)
        return profile
    except Exception as e:
        logger.error(f"Error in get_user_profile_endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get user profile: {str(e)}")

@app.get("/api/user/{user_id}/systems")
async def get_user_systems_endpoint(user_id: str):
    """EXACT COPY from app.py lines 2307-2323"""
    try:
        systems = get_user_systems(user_id)
        return {
            "user_id": user_id,
            "systems": systems,
            "count": len(systems)
        }
    except Exception as e:
        logger.error(f"Error in get_user_systems_endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get user systems: {str(e)}")

@app.post("/api/device/register", response_model=DeviceResponse)
async def register_device_endpoint(device_data: DeviceRegistration):
    """EXACT COPY from app.py lines 2324-2345"""
    try:
        result = register_device_in_db(device_data)
        if not result.success:
            raise HTTPException(status_code=500, detail=result.message)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in register_device_endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to register device: {str(e)}")

@app.delete("/api/device/{user_id}/{device_id}", response_model=DeviceResponse)
async def delete_device_endpoint(user_id: str, device_id: str):
    """EXACT COPY from app.py lines 2346-2373"""
    try:
        result = delete_device_from_db(user_id, device_id)
        if not result.success:
            raise HTTPException(status_code=500, detail=result.message)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in delete_device_endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to delete device: {str(e)}")

# Health check endpoint
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "user-management",
        "timestamp": datetime.now().isoformat()
    }

# AWS Lambda handler
handler = Mangum(app) 
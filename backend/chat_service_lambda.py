"""
Chat Service Lambda Function
Handles: /chat, /health  
Direct split from app.py with NO logic changes
"""

import os
import json
from typing import Dict, List, Optional, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
import requests
from datetime import datetime, timedelta
from mangum import Mangum
import boto3
import logging
from decimal import Decimal

# Langchain imports
from langchain_openai import OpenAIEmbeddings
from langchain_openai import ChatOpenAI
from langchain.memory import ConversationBufferMemory
from langchain_pinecone import PineconeVectorStore
from pinecone.grpc import PineconeGRPC as Pinecone

# Import OpenAI for direct function calling
from openai import OpenAI
import uuid

# Load environment variables
load_dotenv()

#---------------------------------------
# DynamoDB Helper Functions
#---------------------------------------

def convert_dynamodb_decimals(obj):
    """Convert DynamoDB Decimal objects to regular numbers for JSON serialization"""
    if isinstance(obj, list):
        return [convert_dynamodb_decimals(i) for i in obj]
    elif isinstance(obj, dict):
        return {k: convert_dynamodb_decimals(v) for k, v in obj.items()}
    elif isinstance(obj, Decimal):
        return float(obj)
    else:
        return obj

def get_user_profile_if_needed(user_id: str, user_profile: dict = None) -> dict:
    """Get user profile from DynamoDB if not already provided to minimize DB calls"""
    if user_profile:
        return user_profile
    
    try:
        response = table.get_item(
            Key={
                'PK': f'User#{user_id}',
                'SK': 'PROFILE'
            }
        )
        
        if 'Item' in response:
            return convert_dynamodb_decimals(response['Item'])
        else:
            return {"error": f"User profile not found for user {user_id}"}
    except Exception as e:
        print(f"Error getting user profile for {user_id}: {str(e)}")
        return {"error": f"Failed to get user profile: {str(e)}"}

def validate_system_access(user_id: str, system_id: str, user_profile: dict = None) -> bool:
    """Validate that a user has access to a specific system"""
    profile = get_user_profile_if_needed(user_id, user_profile)
    
    if "error" in profile:
        return False
    
    # Admin users have access to all systems
    if profile.get('role') == 'admin':
        return True
    
    # Check if user has access to this specific system
    try:
        response = table.get_item(
            Key={
                'PK': f'User#{user_id}',
                'SK': f'System#{system_id}'
            }
        )
        return 'Item' in response
    except Exception as e:
        print(f"Error validating system access for user {user_id}, system {system_id}: {str(e)}")
        return False

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('app')

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
    # Don't raise here to allow the API to start even if DynamoDB is not available
    dynamodb = None
    table = None

# Create FastAPI app
app = FastAPI(
    title="Chat Service",
    description="Chat service for solar operations and maintenance chatbot",
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

# Get API key from environment variables
api_key = os.getenv("OPENAI_API_KEY")

# Initialize OpenAI client
openai_client = OpenAI(api_key=api_key)

#---------------------------------------
# Pydantic Models - EXACT COPIES from app.py
#---------------------------------------

class ChatMessage(BaseModel):
    """Chat message from the user"""
    username: str
    message: str
    user_id: Optional[str] = None
    jwtToken: Optional[str] = None

class SourceDocument(BaseModel):
    """Source document from the RAG system"""
    content: str
    metadata: Optional[Dict[str, Any]] = None

class ChartData(BaseModel):
    """Chart data for visualization"""
    chart_type: str = "line"
    data_type: str
    title: str
    x_axis_label: str
    y_axis_label: str
    data_points: List[Dict[str, Any]]
    time_period: str
    total_value: Optional[float] = None
    unit: str
    system_name: Optional[str] = None

class ChatResponse(BaseModel):
    """Response from the chatbot"""
    response: str
    source_documents: Optional[List[SourceDocument]] = None
    chart_data: Optional[ChartData] = None

# Sample user context
user_contexts: Dict[str, Dict] = {}

#---------------------------------------
# Main DynamoDB Functions
#---------------------------------------

def get_user_information(user_id: str, data_type: str, user_profile: dict = None) -> dict:
    """
    Get user information from DynamoDB.
    
    Args:
        user_id: The user ID to get information for
        data_type: Type of information to retrieve ('profile' or 'systems')
        user_profile: Optional pre-fetched user profile to minimize DB calls
        
    Returns:
        Dictionary with user information
    """
    try:
        if data_type == "profile":
            # Get user profile
            profile = get_user_profile_if_needed(user_id, user_profile)
            if "error" in profile:
                return profile
            
            return {
                "success": True,
                "data": profile,
                "query_info": {
                    "user_id": user_id,
                    "query_type": "profile"
                }
            }
        
        elif data_type == "systems":
            # Get user's accessible systems
            profile = get_user_profile_if_needed(user_id, user_profile)
            if "error" in profile:
                return profile
            
            if profile.get('role') == 'admin':
                # Admin gets all systems (limited to 50 for performance)
                response = table.scan(
                    FilterExpression='begins_with(PK, :pk) AND SK = :sk',
                    ExpressionAttributeValues={
                        ':pk': 'System#',
                        ':sk': 'PROFILE'
                    },
                    Limit=50
                )
                
                systems = []
                for item in response.get('Items', []):
                    systems.append(convert_dynamodb_decimals(item))
                
                # Get total count for pagination message
                total_response = table.scan(
                    FilterExpression='begins_with(PK, :pk) AND SK = :sk',
                    ExpressionAttributeValues={
                        ':pk': 'System#',
                        ':sk': 'PROFILE'
                    },
                    Select='COUNT'
                )
                
                total_count = total_response.get('Count', len(systems))
                
                result = {
                    "success": True,
                    "data": systems,
                    "query_info": {
                        "user_id": user_id,
                        "query_type": "systems",
                        "user_role": "admin"
                    }
                }
                
                if total_count > 50:
                    result["pagination"] = {
                        "total_systems": total_count,
                        "showing": len(systems),
                        "message": f"Showing {len(systems)} of {total_count} systems. Ask 'show me more systems' to see additional results."
                    }
                
                return result
            else:
                # Regular user gets their linked systems
                response = table.query(
                    KeyConditionExpression='PK = :pk AND begins_with(SK, :sk)',
                    ExpressionAttributeValues={
                        ':pk': f'User#{user_id}',
                        ':sk': 'System#'
                    }
                )
                
                system_links = response.get('Items', [])
                systems = []
                
                # Get full system profiles for each linked system
                for link in system_links:
                    system_id = link.get('systemId')
                    if system_id:
                        system_response = table.get_item(
                            Key={
                                'PK': f'System#{system_id}',
                                'SK': 'PROFILE'
                            }
                        )
                        if 'Item' in system_response:
                            systems.append(convert_dynamodb_decimals(system_response['Item']))
                
                return {
                    "success": True,
                    "data": systems,
                    "query_info": {
                        "user_id": user_id,
                        "query_type": "systems",
                        "systems_count": len(systems)
                    }
                }
        
        else:
            return {"error": f"Invalid data_type '{data_type}'. Use 'profile' or 'systems'."}
    
    except Exception as e:
        print(f"Error in get_user_information: {str(e)}")
        return {"error": f"Failed to get user information: {str(e)}"}

def get_system_information(user_id: str, system_id: str, data_type: str, user_profile: dict = None) -> dict:
    """
    Get system information from DynamoDB.
    
    Args:
        user_id: The user ID requesting the information
        system_id: The system ID to get information for
        data_type: Type of information to retrieve ('profile', 'status', or 'inverter_count')
        user_profile: Optional pre-fetched user profile to minimize DB calls
        
    Returns:
        Dictionary with system information
    """
    try:
        # Validate system access
        if not validate_system_access(user_id, system_id, user_profile):
            return {
                "error": f"You don't have access to system {system_id}",
                "system_id": system_id
            }
        
        if data_type == "profile":
            # Get system profile
            response = table.get_item(
                Key={
                    'PK': f'System#{system_id}',
                    'SK': 'PROFILE'
                }
            )
            
            if 'Item' not in response:
                return {"error": f"System profile not found for system {system_id}"}
            
            system_data = convert_dynamodb_decimals(response['Item'])
            
            return {
                "success": True,
                "data": system_data,
                "query_info": {
                    "user_id": user_id,
                    "system_id": system_id,
                    "query_type": "profile"
                }
            }
        
        elif data_type == "status":
            # Get system status
            response = table.get_item(
                Key={
                    'PK': f'System#{system_id}',
                    'SK': 'STATUS'
                }
            )
            
            if 'Item' not in response:
                return {
                    "success": True,
                    "data": {"note": "No status data available for this system"},
                    "query_info": {
                        "user_id": user_id,
                        "system_id": system_id,
                        "query_type": "status"
                    }
                }
            
            status_data = convert_dynamodb_decimals(response['Item'])
            
            return {
                "success": True,
                "data": status_data,
                "query_info": {
                    "user_id": user_id,
                    "system_id": system_id,
                    "query_type": "status"
                }
            }
        
        elif data_type == "inverter_count":
            # Get count of inverters for this system
            response = table.query(
                IndexName='system-inverter-index',  # Using GSI2
                KeyConditionExpression='GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
                ExpressionAttributeValues={
                    ':pk': f'System#{system_id}',
                    ':sk': 'Inverter#'
                }
            )
            
            inverter_count = len(response.get('Items', []))
            
            return {
                "success": True,
                "data": {
                    "inverter_count": inverter_count,
                    "system_id": system_id
                },
                "query_info": {
                    "user_id": user_id,
                    "system_id": system_id,
                    "query_type": "inverter_count"
                }
            }
        
        else:
            return {"error": f"Invalid data_type '{data_type}'. Use 'profile', 'status', or 'inverter_count'."}
    
    except Exception as e:
        print(f"Error in get_system_information: {str(e)}")
        return {"error": f"Failed to get system information: {str(e)}"}

def get_inverter_information(user_id: str, system_id: str, data_type: str, user_profile: dict = None) -> dict:
    """
    Get inverter information from DynamoDB.
    
    Args:
        user_id: The user ID requesting the information
        system_id: The system ID to get inverters for
        data_type: Type of information to retrieve ('profiles', 'status', or 'details')
        user_profile: Optional pre-fetched user profile to minimize DB calls
        
    Returns:
        Dictionary with inverter information
    """
    try:
        # Validate system access
        if not validate_system_access(user_id, system_id, user_profile):
            return {
                "error": f"You don't have access to system {system_id}",
                "system_id": system_id
            }
        
        # Get all inverters for this system using GSI2
        response = table.query(
            IndexName='system-inverter-index',  # Using GSI2
            KeyConditionExpression='GSI2PK = :pk AND begins_with(GSI2SK, :sk)',
            ExpressionAttributeValues={
                ':pk': f'System#{system_id}',
                ':sk': 'Inverter#'
            }
        )
        
        inverter_links = response.get('Items', [])
        if not inverter_links:
            return {
                "success": True,
                "data": {
                    "note": f"No inverters found for system {system_id}",
                    "inverters": []
                },
                "query_info": {
                    "user_id": user_id,
                    "system_id": system_id,
                    "query_type": data_type
                }
            }
        
        inverters_data = []
        
        for link in inverter_links:
            inverter_id = link.get('GSI2SK', '').replace('Inverter#', '')
            if not inverter_id:
                continue
            
            if data_type == "profiles":
                # Get inverter profile
                inverter_response = table.get_item(
                    Key={
                        'PK': f'Inverter#{inverter_id}',
                        'SK': 'PROFILE'
                    }
                )
                
                if 'Item' in inverter_response:
                    inverters_data.append(convert_dynamodb_decimals(inverter_response['Item']))
            
            elif data_type == "status":
                # Get inverter status
                inverter_response = table.get_item(
                    Key={
                        'PK': f'Inverter#{inverter_id}',
                        'SK': 'STATUS'
                    }
                )
                
                if 'Item' in inverter_response:
                    inverters_data.append(convert_dynamodb_decimals(inverter_response['Item']))
                else:
                    # Add placeholder for missing status
                    inverters_data.append({
                        "inverter_id": inverter_id,
                        "note": "No status data available for this inverter"
                    })
            
            elif data_type == "details":
                # Get both profile and status
                profile_response = table.get_item(
                    Key={
                        'PK': f'Inverter#{inverter_id}',
                        'SK': 'PROFILE'
                    }
                )
                
                status_response = table.get_item(
                    Key={
                        'PK': f'Inverter#{inverter_id}',
                        'SK': 'STATUS'
                    }
                )
                
                inverter_detail = {}
                if 'Item' in profile_response:
                    inverter_detail.update(convert_dynamodb_decimals(profile_response['Item']))
                
                if 'Item' in status_response:
                    inverter_detail.update(convert_dynamodb_decimals(status_response['Item']))
                elif 'Item' in profile_response:
                    inverter_detail['status_note'] = "No status data available"
                
                if inverter_detail:
                    inverters_data.append(inverter_detail)
        
        return {
            "success": True,
            "data": {
                f"system_{system_id}": inverters_data
            },
            "query_info": {
                "user_id": user_id,
                "system_id": system_id,
                "query_type": data_type,
                "inverter_count": len(inverters_data)
            }
        }
    
    except Exception as e:
        print(f"Error in get_inverter_information: {str(e)}")
        return {"error": f"Failed to get inverter information: {str(e)}"}

def get_user_incidents(user_id: str, status: str = None, user_profile: dict = None) -> dict:
    """
    Get user incidents from DynamoDB.
    
    Args:
        user_id: The user ID to get incidents for
        status: Optional status filter ("pending", "processed", or None for all)
        user_profile: Optional pre-fetched user profile to minimize DB calls
        
    Returns:
        Dictionary with incident information
    """
    try:
        # Build query parameters
        query_params = {
            'IndexName': 'incident-user-index',  # Using GSI3
            'KeyConditionExpression': 'GSI3PK = :pk',
            'ExpressionAttributeValues': {
                ':pk': f'User#{user_id}'
            }
        }
        
        # Add status filter if specified
        if status:
            query_params['FilterExpression'] = 'begins_with(PK, :incident_prefix) AND #status = :status'
            query_params['ExpressionAttributeNames'] = {'#status': 'status'}
            query_params['ExpressionAttributeValues'].update({
                ':incident_prefix': 'Incident#',
                ':status': status
            })
        
        response = table.query(**query_params)
        
        incidents = []
        for item in response.get('Items', []):
            incidents.append(convert_dynamodb_decimals(item))
        
        return {
            "success": True,
            "data": {
                "incidents": incidents,
                "total_count": len(incidents),
                "status_filter": status or "all"
            },
            "query_info": {
                "user_id": user_id,
                "query_type": "incidents",
                "status_filter": status
            }
        }
    
    except Exception as e:
        print(f"Error in get_user_incidents: {str(e)}")
        return {"error": f"Failed to get user incidents: {str(e)}"}

#---------------------------------------
# Function definitions for OpenAI function calling
#---------------------------------------

def process_energy_data(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process energy data from the Solar.web API to ensure consistent calculations.
    
    Args:
        data: Raw API response from Solar.web
        
    Returns:
        Processed data with consistent units and calculations
    """
    try:
        print(f"Processing energy data: Starting with raw API response")
        # Clone the original data to avoid modifying it
        processed_data = data.copy()
        
        # Check if this is already a mock response with our format
        if "energy_production" in processed_data:
            print(f"Processing energy data: Already in our format, returning as is")
            return processed_data
            
        # Process real API data
        if "data" in processed_data and isinstance(processed_data["data"], list):
            data_points = processed_data["data"]
            print(f"Processing energy data: Found {len(data_points)} data points")
            
            # Extract values and dates
            values = []
            dates = []
            
            # Handle the nested structure of the API response
            for point in data_points:
                # Extract date from logDateTime field
                if "logDateTime" in point:
                    date = point["logDateTime"]
                    dates.append(date)
                
                # Extract value from channels array
                if "channels" in point and isinstance(point["channels"], list) and len(point["channels"]) > 0:
                    channel = point["channels"][0]  # Assuming the first channel is what we want
                    if "value" in channel and channel["value"] is not None:
                        value = float(channel["value"])
                        values.append(value)
                        print(f"  - Extracted value {value} for date {date}")
            
            print(f"Processing energy data: Extracted {len(values)} values and {len(dates)} dates")
            
            # Calculate total energy if we have values
            if values:
                # Convert to kWh (if values are in Wh)
                total_energy_wh = sum(values)
                total_energy_kwh = total_energy_wh / 1000.0
                
                print(f"Processing energy data: Calculated total energy as {total_energy_wh} Wh = {total_energy_kwh} kWh")
                
                # Add calculated values to the processed data
                processed_data["total_energy_wh"] = total_energy_wh
                processed_data["total_energy_kwh"] = round(total_energy_kwh, 2)
                processed_data["energy_production"] = f"{total_energy_kwh:.2f} kWh"
                
                # Add date range information
                if dates:
                    processed_data["start_date"] = min(dates)
                    processed_data["end_date"] = max(dates)
                
                # Format individual data points consistently
                processed_data["data_points"] = []
                for i, point in enumerate(data_points):
                    date = point.get("logDateTime", f"Point {i+1}")
                    
                    # Extract value from channels array
                    value_wh = 0
                    if "channels" in point and isinstance(point["channels"], list) and len(point["channels"]) > 0:
                        channel = point["channels"][0]
                        if "value" in channel and channel["value"] is not None:
                            value_wh = float(channel["value"])
                    
                    value_kwh = value_wh / 1000.0
                    
                    processed_data["data_points"].append({
                        "date": date,
                        "energy_wh": value_wh,
                        "energy_kwh": round(value_kwh, 2),
                        "energy_production": f"{value_kwh:.2f} kWh"
                    })
        
        print(f"Processing energy data: Processing complete. Final results include:")
        if "total_energy_kwh" in processed_data:
            print(f"  - Total energy: {processed_data['total_energy_kwh']} kWh")
        if "data_points" in processed_data:
            print(f"  - Data points: {len(processed_data['data_points'])}")
            
        return processed_data
    except Exception as e:
        print(f"Error processing energy data: {e}")
        # Return original data if processing fails
        return data

def get_energy_production(system_id: str, start_date: str = None, end_date: str = None, jwt_token: str = None) -> Dict[str, Any]:
    """
    Gets aggregated energy production data for a specific solar system from the Solar.web API.
    
    Args:
        system_id: The ID of the system to get data for
        start_date: Start date in YYYY, YYYY-MM, or YYYY-MM-DD format
        end_date: End date in the same format as start_date
        jwt_token: JWT token for API authentication
        
    Returns:
        A dictionary with energy production data
    """
    
    print(f"Fetching energy production data for system {system_id}, start_date: {start_date}, end_date: {end_date}")
    
    # Validate system_id
    if not system_id:
        return {
            "error": "No system ID provided. Please select a system before querying energy production data.",
            "system_id_required": True
        }
    
    # Base URL for the Solar.web API
    base_url = f"https://api.solarweb.com/swqapi/pvsystems/{system_id}/aggrdata"
    
    # Set up parameters for the API call
    params = {"channel": "EnergyProductionTotal"}
    
    # If no start_date is provided, default to today
    if not start_date:
        start_date = datetime.now().strftime("%Y-%m-%d")
    
    # Add from parameter
    params["from"] = start_date
    
    # Add to parameter if end_date is provided
    if end_date and end_date.strip():
        params["to"] = end_date
    
    # Set up headers for API call
    headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'AccessKeyId': os.getenv('SOLAR_WEB_ACCESS_KEY_ID'),
        'AccessKeyValue': os.getenv('SOLAR_WEB_ACCESS_KEY_VALUE'),
        'Authorization': f'Bearer {jwt_token}' if jwt_token else 'Bearer eyJ4NXQiOiJOalpoT0dJMVpqQXpaVGt5TlRVNU1UbG1NVFkzWVRGbU9UWmpObVE0TURnME1HTmlZbU5sWkEiLCJraWQiOiJORFk0TVdaalpqWmhZakpsT1RRek5UTTVObUUwTkRWa016TXpOak16TmpBd1ptUmlNRFZsT1dRMVpHWmxPVEU1TWpSaU1XVXhZek01TURObU1ESXdaUV9SUzI1NiIsImFsZyI6IlJTMjU2In0.eyJhdF9oYXNoIjoiNUt6S0p1N1Q3RXk1VlZ6QWJQTE14dyIsImF1ZCI6ImMyZ0hwTXpRVUhmQ2ZsV3hIX3dFMkFlZzA5TWEgICAiLCJzdWIiOiJtb25pdG9yaW5nQGphenpzb2xhci5jb20iLCJuYmYiOjE3NDczMTQyNTMsImF6cCI6ImMyZ0hwTXpRVUhmQ2ZsV3hIX3dFMkFlZzA5TWEgICAiLCJhbXIiOlsicGFzc3dvcmQiXSwiaXNzIjoiaHR0cHM6XC9cL2xvZ2luLmZyb25pdXMuY29tXC9vYXV0aDJcL29pZGNkaXNjb3ZlcnkiLCJleHAiOjE3NDczMTc4NTMsImNvbnRhY3RfaWQiOiI2OGRmODA0My03OTI0LWUzMTEtOTc4ZS0wMDUwNTZhMjAwMDMiLCJpYXQiOjE3NDczMTQyNTN9.g9yitwr_6sHLOCRI2TAH7OZ_ibyQznkGmg3oEsdcySag5NYnimo5SY0OXIgTwNhoDkBsvA9BD-EWTN93ED7P1zR4RtUTo3iTJGaH5rTzdk33Tbk0dLGCrKhSj82kpkcLcMrmVtX37_9Kly37Jq1TuYZTOv63skz77uDNfjbHLEhSPyQueQlRtIsdU5z32OMx_0SJmP8V9llpm2T40Farr2OUNj_YczX98oC9xIO2aUBGSRPPYQFE5PQxAoNjl478-QeSoo2qNaHYlwlqBmJXOdukA1Kz6GBWKn2KNfp5r8r6x3UQGS_vys54ruwom-ZQbip7AAELesQdqNXiVEvZyg'
    }
    
    try:
        # Make the API call with GET
        print(f"Calling Solar.web API with URL: {base_url}, params: {params}")
        response = requests.get(
            base_url, 
            params=params, 
            headers=headers
        )
        
        # Check if the request was successful
        if response.status_code == 200:
            data = response.json()
            print(f"API call successful, received data: {data}")
            # Process the data to ensure consistent calculations
            return process_energy_data(data)
        else:
            print(f"API call failed with status code {response.status_code}: {response.text}")
            
            # Fall back to mock data if the API call fails
            print("Using mock data as fallback")
            # Determine format based on the from parameter
            date_format = params["from"]
            if len(date_format) == 4:  # YYYY
                format_str = "%Y"
                unit = "year"
            elif len(date_format) == 7:  # YYYY-MM
                format_str = "%Y-%m"
                unit = "month"
            else:  # YYYY-MM-DD
                format_str = "%Y-%m-%d"
                unit = "day"
                
            start_date_obj = datetime.strptime(params["from"], format_str)
            
            # Calculate duration or use end_date for mock data
            if "to" in params:
                end_date_format = params["to"]
                end_date_obj = datetime.strptime(end_date_format, format_str)
                
                if unit == "year":
                    mock_duration = end_date_obj.year - start_date_obj.year + 1
                elif unit == "month":
                    mock_duration = ((end_date_obj.year - start_date_obj.year) * 12 + 
                                    end_date_obj.month - start_date_obj.month + 1)
                else:  # day
                    mock_duration = (end_date_obj - start_date_obj).days + 1
            else:
                mock_duration = 1
            
            total_energy = 25.7 * mock_duration
            
            mock_data = {
                "system_id": system_id,
                "start_date": params["from"],
                "end_date": params.get("to", ""),
                "energy_production": f"{total_energy:.2f} kWh",
                "total_energy_kwh": round(total_energy, 2),
                "unit": unit,
                "data_points": []
            }
            
            for i in range(mock_duration):
                if unit == "day":
                    date_str = (start_date_obj + timedelta(days=i)).strftime("%Y-%m-%d")
                    value = 25.7 + (i * 1.5)  # Mock increasing values
                elif unit == "month":
                    # Add months by adding 32 days and formatting to YYYY-MM
                    next_month = start_date_obj.replace(day=1) + timedelta(days=32*i)
                    date_str = next_month.strftime("%Y-%m")
                    value = 780.5 + (i * 45.8)
                else:  # year
                    date_str = str(start_date_obj.year + i)
                    value = 9500.3 + (i * 520.7)
                    
                mock_data["data_points"].append({
                    "date": date_str,
                    "energy_wh": value * 1000,
                    "energy_kwh": round(value, 2),
                    "energy_production": f"{value:.2f} kWh"
                })
                
            return mock_data
    except Exception as e:
        print(f"Error fetching energy production data: {e}")
        return {"error": f"Failed to fetch energy production data: {str(e)}"}

def process_co2_data(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process CO2 savings data from the Solar.web API to ensure consistent calculations.
    
    Args:
        data: Raw API response from Solar.web
        
    Returns:
        Processed data with consistent units and calculations
    """
    try:
        print(f"Processing CO2 data: Starting with raw API response")
        # Clone the original data to avoid modifying it
        processed_data = data.copy()
        
        # Check if this is already a mock response with our format
        if "co2_savings" in processed_data:
            print(f"Processing CO2 data: Already in our format, returning as is")
            return processed_data
            
        # Process real API data
        if "data" in processed_data and isinstance(processed_data["data"], list):
            data_points = processed_data["data"]
            print(f"Processing CO2 data: Found {len(data_points)} data points")
            
            # Extract values and dates
            values = []
            dates = []
            
            # Handle the nested structure of the API response
            for point in data_points:
                # Extract date from logDateTime field
                if "logDateTime" in point:
                    date = point["logDateTime"]
                    dates.append(date)
                
                # Extract value from channels array
                if "channels" in point and isinstance(point["channels"], list) and len(point["channels"]) > 0:
                    channel = point["channels"][0]  # Assuming the first channel is what we want
                    if "value" in channel and channel["value"] is not None:
                        value = float(channel["value"])
                        values.append(value)
                        print(f"  - Extracted CO2 value {value} for date {date}")
            
            print(f"Processing CO2 data: Extracted {len(values)} values and {len(dates)} dates")
            
            # Calculate total CO2 savings if we have values
            if values:
                # Calculate total CO2 savings in kg
                total_co2_kg = sum(values)
                
                print(f"Processing CO2 data: Calculated total CO2 savings as {total_co2_kg} kg")
                
                # Add calculated values to the processed data
                processed_data["total_co2_kg"] = round(total_co2_kg, 2)
                processed_data["co2_savings"] = f"{total_co2_kg:.2f} kg"
                
                # Add date range information
                if dates:
                    processed_data["start_date"] = min(dates)
                    processed_data["end_date"] = max(dates)
                
                # Format individual data points consistently
                processed_data["data_points"] = []
                for i, point in enumerate(data_points):
                    date = point.get("logDateTime", f"Point {i+1}")
                    
                    # Extract value from channels array
                    value_kg = 0
                    if "channels" in point and isinstance(point["channels"], list) and len(point["channels"]) > 0:
                        channel = point["channels"][0]
                        if "value" in channel and channel["value"] is not None:
                            value_kg = float(channel["value"])
                    
                    processed_data["data_points"].append({
                        "date": date,
                        "co2_kg": round(value_kg, 2),
                        "co2_savings": f"{value_kg:.2f} kg"
                    })
        
        print(f"Processing CO2 data: Processing complete. Final results include:")
        if "total_co2_kg" in processed_data:
            print(f"  - Total CO2 savings: {processed_data['total_co2_kg']} kg")
        if "data_points" in processed_data:
            print(f"  - Data points: {len(processed_data['data_points'])}")
            
        return processed_data
    except Exception as e:
        print(f"Error processing CO2 data: {e}")
        # Return original data if processing fails
        return data

def get_co2_savings(system_id: str, start_date: str = None, end_date: str = None, jwt_token: str = None) -> Dict[str, Any]:
    """
    Gets aggregated CO2 savings data for a specific solar system from the Solar.web API.
    
    Args:
        system_id: The ID of the system to get data for
        start_date: Start date in YYYY, YYYY-MM, or YYYY-MM-DD format
        end_date: End date in the same format as start_date
        jwt_token: JWT token for API authentication
        
    Returns:
        A dictionary with CO2 savings data
    """
    
    print(f"Fetching CO2 savings data for system {system_id}, start_date: {start_date}, end_date: {end_date}")
    
    # Validate system_id
    if not system_id:
        return {
            "error": "No system ID provided. Please select a system before querying CO2 savings data.",
            "system_id_required": True
        }
    
    # Base URL for the Solar.web API
    base_url = f"https://api.solarweb.com/swqapi/pvsystems/{system_id}/aggrdata"
    
    # Set up parameters for the API call
    params = {"channel": "SavingsCO2"}
    
    # If no start_date is provided, default to today
    if not start_date:
        start_date = datetime.now().strftime("%Y-%m-%d")
    
    # Add from parameter
    params["from"] = start_date
    
    # Add to parameter if end_date is provided
    if end_date and end_date.strip():
        params["to"] = end_date
    
    # Set up headers for API call
    headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'AccessKeyId': os.getenv('SOLAR_WEB_ACCESS_KEY_ID'),
        'AccessKeyValue': os.getenv('SOLAR_WEB_ACCESS_KEY_VALUE'),
        'Authorization': f'Bearer {jwt_token}' if jwt_token else 'Bearer eyJ4NXQiOiJOalpoT0dJMVpqQXpaVGt5TlRVNU1UbG1NVFkzWVRGbU9UWmpObVE0TURnME1HTmlZbU5sWkEiLCJraWQiOiJORFk0TVdaalpqWmhZakpsT1RRek5UTTVObUUwTkRWa016TXpOak16TmpBd1ptUmlNRFZsT1dRMVpHWmxPVEU1TWpSaU1XVXhZek01TURObU1ESXdaUV9SUzI1NiIsImFsZyI6IlJTMjU2In0.eyJhdF9oYXNoIjoiNUt6S0p1N1Q3RXk1VlZ6QWJQTE14dyIsImF1ZCI6ImMyZ0hwTXpRVUhmQ2ZsV3hIX3dFMkFlZzA5TWEgICAiLCJzdWIiOiJtb25pdG9yaW5nQGphenpzb2xhci5jb20iLCJuYmYiOjE3NDczMTQyNTMsImF6cCI6ImMyZ0hwTXpRVUhmQ2ZsV3hIX3dFMkFlZzA5TWEgICAiLCJhbXIiOlsicGFzc3dvcmQiXSwiaXNzIjoiaHR0cHM6XC9cL2xvZ2luLmZyb25pdXMuY29tXC9vYXV0aDJcL29pZGNkaXNjb3ZlcnkiLCJleHAiOjE3NDczMTc4NTMsImNvbnRhY3RfaWQiOiI2OGRmODA0My03OTI0LWUzMTEtOTc4ZS0wMDUwNTZhMjAwMDMiLCJpYXQiOjE3NDczMTQyNTN9.g9yitwr_6sHLOCRI2TAH7OZ_ibyQznkGmg3oEsdcySag5NYnimo5SY0OXIgTwNhoDkBsvA9BD-EWTN93ED7P1zR4RtUTo3iTJGaH5rTzdk33Tbk0dLGCrKhSj82kpkcLcMrmVtX37_9Kly37Jq1TuYZTOv63skz77uDNfjbHLEhSPyQueQlRtIsdU5z32OMx_0SJmP8V9llpm2T40Farr2OUNj_YczX98oC9xIO2aUBGSRPPYQFE5PQxAoNjl478-QeSoo2qNaHYlwlqBmJXOdukA1Kz6GBWKn2KNfp5r8r6x3UQGS_vys54ruwom-ZQbip7AAELesQdqNXiVEvZyg'
    }
    
    try:
        # Make the API call with GET
        print(f"Calling Solar.web API with URL: {base_url}, params: {params}")
        response = requests.get(
            base_url, 
            params=params, 
            headers=headers
        )
        
        # Check if the request was successful
        if response.status_code == 200:
            data = response.json()
            print(f"API call successful, received data: {data}")
            # Process the data to ensure consistent calculations
            return process_co2_data(data)
        else:
            print(f"API call failed with status code {response.status_code}: {response.text}")
            
            # Fall back to mock data if the API call fails
            print("Using mock data as fallback")
            # Determine format based on the from parameter
            date_format = params["from"]
            if len(date_format) == 4:  # YYYY
                format_str = "%Y"
                unit = "year"
            elif len(date_format) == 7:  # YYYY-MM
                format_str = "%Y-%m"
                unit = "month"
            else:  # YYYY-MM-DD
                format_str = "%Y-%m-%d"
                unit = "day"
                
            start_date_obj = datetime.strptime(params["from"], format_str)
            
            # Calculate duration or use end_date for mock data
            if "to" in params:
                end_date_format = params["to"]
                end_date_obj = datetime.strptime(end_date_format, format_str)
                
                if unit == "year":
                    mock_duration = end_date_obj.year - start_date_obj.year + 1
                elif unit == "month":
                    mock_duration = ((end_date_obj.year - start_date_obj.year) * 12 + 
                                    end_date_obj.month - start_date_obj.month + 1)
                else:  # day
                    mock_duration = (end_date_obj - start_date_obj).days + 1
            else:
                mock_duration = 1
            
            total_co2 = 8.2 * mock_duration
            
            mock_data = {
                "system_id": system_id,
                "start_date": params["from"],
                "end_date": params.get("to", ""),
                "co2_savings": f"{total_co2:.2f} kg",
                "total_co2_kg": round(total_co2, 2),
                "unit": unit,
                "data_points": []
            }
            
            for i in range(mock_duration):
                if unit == "day":
                    date_str = (start_date_obj + timedelta(days=i)).strftime("%Y-%m-%d")
                    value = 8.2 + (i * 0.5)  # Mock increasing values
                elif unit == "month":
                    # Add months by adding 32 days and formatting to YYYY-MM
                    next_month = start_date_obj.replace(day=1) + timedelta(days=32*i)
                    date_str = next_month.strftime("%Y-%m")
                    value = 240.5 + (i * 15.2)
                else:  # year
                    date_str = str(start_date_obj.year + i)
                    value = 2900.5 + (i * 180.3)
                    
                mock_data["data_points"].append({
                    "date": date_str,
                    "co2_kg": round(value, 2),
                    "co2_savings": f"{value:.2f} kg"
                })
                
            return mock_data
    except Exception as e:
        print(f"Error fetching CO2 savings data: {e}")
        return {"error": f"Failed to fetch CO2 savings data: {str(e)}"}

def get_flow_data(system_id: str, jwt_token: str = None) -> Dict[str, Any]:
    """Get real-time flow data for a specific system"""
    try:
        # Validate system_id
        if not system_id:
            return {"error": "System ID is required"}
        
        # Get flow data from DynamoDB
        response = table.get_item(
            Key={
                'PK': f'System#{system_id}',
                'SK': 'FLOW'
            }
        )
        
        if 'Item' not in response:
            return {"error": f"No flow data found for system {system_id}"}
        
        item = response['Item']
        
        # Check if system is online based on last update timestamp
        last_updated = item.get('timestamp')
        is_online = False
        
        if last_updated:
            try:
                # Parse the timestamp and check if it's recent (within last 10 minutes)
                from datetime import datetime, timezone
                last_update_time = datetime.fromisoformat(last_updated.replace('Z', '+00:00'))
                current_time = datetime.now(timezone.utc)
                time_diff = (current_time - last_update_time).total_seconds()
                is_online = time_diff < 600  # 10 minutes
            except:
                is_online = False
        
        # Extract power data
        channels = item.get('channels', {})
        power_pv = 0
        
        # Look for PowerPV channel
        for channel_id, channel_data in channels.items():
            if isinstance(channel_data, dict) and channel_data.get('channelType') == 'PowerPV':
                power_pv = channel_data.get('value', 0)
                break
        
        return {
            "system_id": system_id,
            "isOnline": is_online,
            "lastUpdated": last_updated,
            "powerPV": power_pv,
            "channels": channels
        }
        
    except Exception as e:
        print(f"Error getting flow data for system {system_id}: {str(e)}")
        return {"error": f"Failed to get flow data: {str(e)}"}

# Note: determine_api_date_format function removed - LLM now handles API format optimization


# Note: aggregate_data_points function removed - LLM chooses optimal API format, API returns pre-aggregated data


# Note: get_data_point_value function removed - simplified data processing in generate_chart_data


def generate_chart_data(
    data_type: str,
    system_id: str,
    start_date: str,
    end_date: str,
    time_period: str = "custom",
    jwt_token: str = None
) -> Dict[str, Any]:
    """
    Generate chart data for visualization with LLM-optimized API calls.
    
    Args:
        data_type: "energy_production", "co2_savings", "earnings"
        system_id: The solar system ID
        start_date: Start date in YYYY, YYYY-MM, or YYYY-MM-DD format (LLM optimized)
        end_date: End date in same format as start_date
        time_period: Descriptive label for chart type determination
        jwt_token: JWT token for authentication
    
    Returns:
        ChartData formatted for frontend visualization
    """
    logger.info(f"=== GENERATE_CHART_DATA (LLM Enhanced) START ===")
    logger.info(f"Parameters received:")
    logger.info(f"  - data_type: {data_type}")
    logger.info(f"  - system_id: {system_id}")
    logger.info(f"  - start_date: {start_date}")
    logger.info(f"  - end_date: {end_date}")
    logger.info(f"  - time_period: {time_period}")
    logger.info(f"  - jwt_token: {'[PROVIDED]' if jwt_token else '[NOT PROVIDED]'}")
    
    try:
        # Get system profile for name
        system_name = "Solar System"
        try:
            profile_response = table.get_item(
                Key={'PK': f'System#{system_id}', 'SK': 'PROFILE'}
            )
            if 'Item' in profile_response:
                system_name = profile_response['Item'].get('name', f"System {system_id}")
                logger.info(f"System profile found - name: {system_name}")
        except Exception as e:
            logger.error(f"Error fetching system profile: {str(e)}")
        
        # Direct API call with LLM-optimized dates (no format conversion)
        raw_data = None
        total_value = 0
        unit = ""
        
        logger.info(f"Making direct API call with dates: {start_date} to {end_date}")
        
        if data_type in ["energy_production", "earnings"]:
            raw_data = get_energy_production(system_id, start_date, end_date, jwt_token)
            
            if "error" in raw_data:
                logger.error(f"Error in energy data: {raw_data['error']}")
                return {"error": raw_data["error"]}
            
            total_value = float(raw_data.get('total_energy_kwh', 0))
            if data_type == "earnings":
                total_value = total_value * 0.40
                unit = "$"
            else:
                unit = "kWh"
                
        elif data_type == "co2_savings":
            raw_data = get_co2_savings(system_id, start_date, end_date, jwt_token)
            
            if "error" in raw_data:
                logger.error(f"Error in CO2 data: {raw_data['error']}")
                return {"error": raw_data["error"]}
            
            total_value = float(raw_data.get('total_co2_kg', 0))
            unit = "kg CO2"
        
        # Simple data points formatting (API returns pre-aggregated data)
        raw_data_points = raw_data.get('data_points', [])
        chart_data_points = []
        
        for data_point in raw_data_points:
            date_str = data_point.get('date', '')
            
            # Simple value extraction
            if data_type == "energy_production":
                value = float(data_point.get('energy_kwh', 0))
            elif data_type == "earnings":
                value = float(data_point.get('energy_kwh', 0)) * 0.40
            elif data_type == "co2_savings":
                value = float(data_point.get('co2_kg', 0))
            else:
                value = 0
            
            # Simple date formatting for x-axis
            try:
                if len(date_str) == 4:  # YYYY
                    x_label = date_str
                elif len(date_str) == 7:  # YYYY-MM
                    date_obj = datetime.strptime(date_str, "%Y-%m")
                    x_label = date_obj.strftime("%b %Y")
                elif len(date_str) >= 10:  # YYYY-MM-DD
                    date_obj = datetime.strptime(date_str[:10], "%Y-%m-%d")
                    x_label = date_obj.strftime("%m/%d")
                else:
                    x_label = date_str
            except ValueError:
                x_label = date_str
                
            chart_data_points.append({
                "x": x_label,
                "y": round(value, 2)
            })
        
        # Simple chart type determination based on date format
        if len(start_date) == 4:  # Yearly format
            chart_type = "bar"
            period_text = f"Years {start_date}-{end_date}" if start_date != end_date else f"Year {start_date}"
        elif len(start_date) == 7:  # Monthly format  
            chart_type = "bar"
            try:
                start_formatted = datetime.strptime(start_date, "%Y-%m").strftime("%B %Y")
                if start_date != end_date:
                    end_formatted = datetime.strptime(end_date, "%Y-%m").strftime("%B %Y")
                    period_text = f"{start_formatted} - {end_formatted}"
                else:
                    period_text = start_formatted
            except ValueError:
                period_text = f"{start_date} - {end_date}" if start_date != end_date else start_date
        else:  # Daily format
            try:
                start_dt = datetime.strptime(start_date, "%Y-%m-%d")
                end_dt = datetime.strptime(end_date, "%Y-%m-%d")
                days_diff = (end_dt - start_dt).days + 1
                
                chart_type = "line" if days_diff <= 30 else "bar"
                
                if days_diff == 1:
                    period_text = start_dt.strftime("%B %d, %Y")
                else:
                    start_formatted = start_dt.strftime("%B %d")
                    end_formatted = end_dt.strftime("%B %d, %Y")
                    period_text = f"{start_formatted} - {end_formatted}"
            except ValueError:
                chart_type = "bar"
                period_text = f"{start_date} - {end_date}"
        
        # Generate title
        data_type_text = {
            "energy_production": "Energy Production",
            "co2_savings": "CO2 Savings",
            "earnings": "Earnings"
        }.get(data_type, data_type)
        
        title = f"{data_type_text} - {period_text}"
        
        # Create simplified chart data
        chart_data = {
            "chart_type": chart_type,
            "data_type": data_type,
            "title": title,
            "x_axis_label": "Time Period",
            "y_axis_label": f"{data_type_text} ({unit})",
            "data_points": chart_data_points,
            "time_period": time_period,
            "total_value": round(total_value, 2),
            "unit": unit,
            "system_name": system_name
        }
        
        logger.info(f"Generated chart with {len(chart_data_points)} points, total: {total_value} {unit}")
        logger.info(f"Chart type: {chart_type}, Title: {title}")
        logger.info(f"=== GENERATE_CHART_DATA SUCCESS ===")
        return chart_data
        
    except Exception as e:
        logger.error(f"=== GENERATE_CHART_DATA ERROR ===")
        logger.error(f"Error generating chart data: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return {"error": f"Failed to generate chart data: {str(e)}"}

def search_vector_db(query: str, limit: int = 100) -> List[Dict[str, Any]]:
    """
    Search the vector database for relevant documents.
    
    Args:
        query: The search query
        limit: Maximum number of results to return
        
    Returns:
        A list of relevant documents
    """
    # Get the RAG instance
    rag = get_rag_instance()
    if not rag or not rag.vector_store:
        return [{"content": "Vector database is not available", "score": 0}]
    
    # Search the vector store
    try:
        # Search the vector store directly
        results = rag.retriever.get_relevant_documents(query)
        print(f"\n===== RETRIEVED {len(results[:limit])} CHUNKS FROM KNOWLEDGE BASE =====")
        for i, doc in enumerate(results[:limit]):
            print(f"\n=====CHUNK {i+1}=====")
            print(f"Content: {doc.page_content}")
            print(f"Metadata: {doc.metadata}")
            print("=" * 50)
        
        # Convert to the expected format
        return [
            {
                "content": doc.page_content,
                "metadata": doc.metadata,
                "score": 0.9 - (i * 0.1)  # Mock similarity score
            }
            for i, doc in enumerate(results[:limit])
        ]
    except Exception as e:
        print(f"Error searching vector database: {e}")
        return [{"content": f"Error searching vector database: {str(e)}", "score": 0}]

# A function to generate the energy production function description with current dates
def get_energy_production_description():
    return (
        "Get aggregated energy production data for a specific solar system. "
        "Use this for questions about historical energy production over specific time periods.\n"
        "This function expects actual date strings, not relative terms like 'this week' or 'last month'. "
        "You must convert time references to actual dates before calling this function.\n\n"
        "Date format requirements:\n"
        "- Use YYYY for years (e.g., '2023')\n"
        "- Use YYYY-MM for months (e.g., '2023-05')\n"
        "- Use YYYY-MM-DD for days (e.g., '2023-05-15')\n"
        "- start_date and end_date MUST use the EXACT same format (both YYYY, both YYYY-MM, or both YYYY-MM-DD)\n\n"
        "Examples:\n"
        "- 'What was my energy production yesterday?' → Convert 'yesterday' to an actual date\n"
        "- 'How much energy did I produce last week?' → Convert 'last week' to date range (Monday to Sunday)\n"
        "- 'Show me energy data for May 2023' → start_date='2023-05', end_date='2023-05'\n"
        "- 'How much energy did I produce in 2022?' → start_date='2022', end_date='2022'\n"
        "- 'Show me production from January to March 2023' → start_date='2023-01', end_date='2023-03'"
    )

# A function to generate the CO2 savings function description with current dates
def get_co2_savings_description():
    return (
        "Get aggregated CO2 savings data for a specific solar system. "
        "Use this for questions about environmental impact and carbon reduction from the system.\n"
        "This function expects actual date strings, not relative terms like 'this week' or 'last month'. "
        "You must convert time references to actual dates before calling this function.\n\n"
        "Date format requirements:\n"
        "- Use YYYY for years (e.g., '2023')\n"
        "- Use YYYY-MM for months (e.g., '2023-05')\n"
        "- Use YYYY-MM-DD for days (e.g., '2023-05-15')\n"
        "- start_date and end_date MUST use the EXACT same format (both YYYY, both YYYY-MM, or both YYYY-MM-DD)\n\n"
        "Examples:\n"
        "- 'How much CO2 did I save yesterday?' → Convert 'yesterday' to an actual date\n"
        "- 'What were my carbon savings last week?' → Convert 'last week' to date range (Monday to Sunday)\n"
        "- 'Show me CO2 data for June 2023' → start_date='2023-06', end_date='2023-06'\n"
        "- 'How much carbon did I avoid in 2022?' → start_date='2022', end_date='2022'\n"
        "- 'What were my CO2 savings from April to June 2023?' → start_date='2023-04', end_date='2023-06'"
    )

# Function specifications with strategic ordering and detailed descriptions
FUNCTION_SPECS = [
        # HIGH PRIORITY: Direct user/system queries (most common)
        {
            "type": "function",
            "function": {
                "name": "get_user_information",
                "description": (
                    "Get user information from the DynamoDB database. Use this for questions about the user's profile or accessible systems.\n\n"
                    "SPECIFIC QUESTION EXAMPLES:\n"
                    "- 'What systems do I have access to?'\n"
                    "- 'What's my email address?'\n"
                    "- 'What's my name?'\n"
                    "- 'What's my role?'\n"
                    "- 'Who is my technician?'\n"
                    "- 'Show me my profile information'\n"
                    "- 'What systems am I linked to?'\n"
                    "- 'How many systems do I have?'\n\n"
                    "DATA_TYPE OPTIONS:\n"
                    "- 'profile': Returns complete user profile with all available fields\n"
                    "- 'systems': Returns all accessible systems with full system information\n\n"
                    "RESPONSE FORMAT:\n"
                    "Returns complete structured data - the LLM will extract specific information as needed."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "user_id": {
                            "type": "string",
                            "description": "The user ID to get information for"
                        },
                        "data_type": {
                            "type": "string",
                            "description": "Type of information to retrieve: 'profile' or 'systems'"
                        }
                    },
                    "required": ["user_id", "data_type"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_system_information",
                "description": (
                    "Get system information from the DynamoDB database. Use this for questions about specific system details, status, or configuration.\n\n"
                    "SPECIFIC QUESTION EXAMPLES:\n"
                    "- 'Where is my system located?'\n"
                    "- 'What's the address of my system?'\n"
                    "- 'How big is my system?'\n"
                    "- 'What's the AC power of my system?'\n"
                    "- 'What's the DC capacity of my system?'\n"
                    "- 'What's the status of my system?'\n"
                    "- 'When was my system installed?'\n"
                    "- 'How many inverters does my system have?'\n"
                    "- 'What's my system's name?'\n"
                    "- 'Show me my system profile'\n\n"
                    "DATA_TYPE OPTIONS:\n"
                    "- 'profile': Returns complete system profile with all configuration details\n"
                    "- 'status': Returns system status information including inverter counts\n"
                    "- 'inverter_count': Returns count of inverters for this system\n\n"
                    "RESPONSE FORMAT:\n"
                    "Returns complete structured data - the LLM will extract specific information as needed."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "user_id": {
                            "type": "string",
                            "description": "The user ID requesting the information"
                        },
                        "system_id": {
                            "type": "string",
                            "description": "The system ID to get information for"
                        },
                        "data_type": {
                            "type": "string",
                            "description": "Type of information to retrieve: 'profile', 'status', or 'inverter_count'"
                        }
                    },
                    "required": ["user_id", "system_id", "data_type"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search_vector_db",
                "description": (
                    "Search the knowledge base for general solar-related information, troubleshooting, error codes, or maintenance guidance. "
                    "Use this for non-system-specific questions like support, documentation, or general education.\n"
                    "Examples: "
                    "'Who do I contact if something goes wrong?', "
                    "'What does error code 105 mean?', "
                    "'What should I do if my inverter is flashing red?', "
                    "'How do I clean my solar panels?'"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The query to search for in the vector database"
                        },
                        "limit": {
                            "type": "integer",
                            "description": "The maximum number of results to return",
                            "default": 3
                        }
                    },
                    "required": ["query"]
                }
            }
        },
        # MEDIUM PRIORITY: Energy/data queries
        {
            "type": "function",
            "function": {
                "name": "get_energy_production",
                "description": get_energy_production_description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "system_id": {
                            "type": "string",
                            "description": "The ID of the system to get data for"
                        },
                        "start_date": {
                            "type": "string",
                            "description": "Start date in YYYY, YYYY-MM, or YYYY-MM-DD format. You must convert relative terms like 'today', 'this week', 'last month' to actual dates."
                        },
                        "end_date": {
                            "type": "string",
                            "description": "End date in the same format as start_date (YYYY, YYYY-MM, or YYYY-MM-DD). The format must match start_date.",
                            "default": ""
                        }
                    },
                    "required": ["system_id", "start_date"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_co2_savings",
                "description": get_co2_savings_description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "system_id": {
                            "type": "string",
                            "description": "The ID of the system to get data for"
                        },
                        "start_date": {
                            "type": "string",
                            "description": "Start date in YYYY, YYYY-MM, or YYYY-MM-DD format. You must convert relative terms like 'today', 'this week', 'last month' to actual dates."
                        },
                        "end_date": {
                            "type": "string",
                            "description": "End date in the same format as start_date (YYYY, YYYY-MM, or YYYY-MM-DD). The format must match start_date.",
                            "default": ""
                        }
                    },
                    "required": ["system_id", "start_date"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_flow_data",
                "description": (
                    "Get real-time power flow data for a specific solar system. "
                    "Use this ONLY for two specific types of questions:\n"
                    "1. When the user asks about system status (online/offline) - check the 'isOnline' status\n"
                    "2. When the user asks about current power or peak power - check the 'PowerPV' channel value\n\n"
                    "Examples:\n"
                    "'Is my system online?', "
                    "'What's the current power output?', "
                    "'How much power is my system generating right now?'"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "system_id": {
                            "type": "string",
                            "description": "The ID of the system to get real-time flow data for"
                        }
                    },
                    "required": ["system_id"]
                }
            }
        },
        # LOWER PRIORITY: Technical details and specialized queries
        {
            "type": "function",
            "function": {
                "name": "get_inverter_information",
                "description": (
                    "Get inverter information from the DynamoDB database. Use this for questions about specific inverter details or status.\n\n"
                    "SPECIFIC QUESTION EXAMPLES:\n"
                    "- 'What inverters do I have?'\n"
                    "- 'What's the status of my inverters?'\n"
                    "- 'How many MPPT trackers do I have?'\n"
                    "- 'Show me my inverter details'\n"
                    "- 'What's the power rating of my inverters?'\n"
                    "- 'Are my inverters online?'\n"
                    "- 'What's my inverter model?'\n"
                    "- 'Show me inverter firmware versions'\n\n"
                    "DATA_TYPE OPTIONS:\n"
                    "- 'profiles': Returns complete inverter profiles with all technical details\n"
                    "- 'status': Returns inverter status information\n"
                    "- 'details': Returns combined profile and status information\n\n"
                    "RESPONSE FORMAT:\n"
                    "Returns complete structured data - the LLM will extract specific information as needed."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "user_id": {
                            "type": "string",
                            "description": "The user ID requesting the information"
                        },
                        "system_id": {
                            "type": "string",
                            "description": "The system ID to get inverters for"
                        },
                        "data_type": {
                            "type": "string",
                            "description": "Type of information to retrieve: 'profiles', 'status', or 'details'"
                        }
                    },
                    "required": ["user_id", "system_id", "data_type"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "get_user_incidents",
                "description": (
                    "Get user incident information from the DynamoDB database. Use this for questions about incidents, alerts, or system issues.\n\n"
                    "SPECIFIC QUESTION EXAMPLES:\n"
                    "- 'What incidents do I have?'\n"
                    "- 'Show me my recent incidents'\n"
                    "- 'Do I have any pending incidents?'\n"
                    "- 'What's my incident history?'\n"
                    "- 'Show me processed incidents'\n"
                    "- 'How many incidents do I have?'\n"
                    "- 'What alerts do I have?'\n"
                    "- 'Show me my system issues'\n"
                    "- 'Any problems with my system?'\n"
                    "- 'What's my incident status?'\n\n"
                    "AVAILABLE DATA FIELDS:\n"
                    "Incident: status, systemId, deviceId, userId, processedAt, expiresAt, incident details\n\n"
                    "STATUS OPTIONS:\n"
                    "- 'pending': Shows only pending incidents\n"
                    "- 'processed': Shows only processed incidents\n"
                    "- Leave empty or null: Shows all incidents\n\n"
                    "RESPONSE FORMAT:\n"
                    "Returns structured data with incidents array, total count, status filter, and query_info for tracking."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "user_id": {
                            "type": "string",
                            "description": "The user ID to get incidents for"
                        },
                        "status": {
                            "type": "string",
                            "description": "Optional status filter: 'pending', 'processed', or leave empty for all incidents",
                            "default": ""
                        }
                    },
                    "required": ["user_id"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "generate_chart_data",
                "description": (
                    "Generate chart data for visualization when user asks to 'show', 'display', 'graph', 'chart', or 'visualize' data.\n\n"
                    "SOLAR.WEB API FORMAT OPTIMIZATION:\n"
                    "The Solar.web API supports different aggregation levels. Choose the optimal format:\n\n"
                    "YEARLY FORMAT (YYYY): Use for multi-year requests\n"
                    "- 'last 2 years' → start_date='2023', end_date='2024'\n"
                    "- '2020 to 2023' → start_date='2020', end_date='2023'\n"
                    "- Returns pre-aggregated yearly totals, use bar chart\n\n"
                    "MONTHLY FORMAT (YYYY-MM): Use for monthly trends, quarters, year-parts\n"
                    "- 'first 6 months of 2025' → start_date='2025-01', end_date='2025-06'\n" 
                    "- 'Q1 2024' → start_date='2024-01', end_date='2024-03'\n"
                    "- 'last 8 months' → start_date='2024-04', end_date='2024-12'\n"
                    "- Returns pre-aggregated monthly totals, use bar chart\n\n"
                    "DAILY FORMAT (YYYY-MM-DD): Use for daily/weekly trends, short periods\n"
                    "- 'last 14 days' → start_date='2024-12-03', end_date='2024-12-17'\n"
                    "- 'this week' → start_date='2024-12-16', end_date='2024-12-22'\n"
                    "- 'December 1-15' → start_date='2024-12-01', end_date='2024-12-15'\n"
                    "- Returns daily data points, use line chart for ≤30 days, bar chart for >30 days\n\n"
                    "IMPORTANT: start_date and end_date MUST use the SAME format (both YYYY, both YYYY-MM, or both YYYY-MM-DD)"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "data_type": {
                            "type": "string",
                            "enum": ["energy_production", "co2_savings", "earnings"],
                            "description": "Type of data to chart"
                        },
                        "system_id": {
                            "type": "string",
                            "description": "The ID of the system to get data for"
                        },
                        "start_date": {
                            "type": "string",
                            "description": "Start date in YYYY, YYYY-MM, or YYYY-MM-DD format based on optimal API aggregation level"
                        },
                        "end_date": {
                            "type": "string",
                            "description": "End date in same format as start_date"
                        },
                        "time_period": {
                            "type": "string",
                            "description": "Descriptive label for the chart (e.g., 'last_14_days', 'Q1_2024', 'yearly_trend') to help determine chart type"
                        }
                    },
                    "required": ["data_type", "system_id", "start_date", "end_date", "time_period"]
                }
            }
        }
    ]

# Function map for executing called functions
FUNCTION_MAP = {
    "search_vector_db": search_vector_db,
    "get_energy_production": get_energy_production,
    "get_co2_savings": get_co2_savings,
    "get_flow_data": get_flow_data,
    "generate_chart_data": generate_chart_data,
    "get_user_information": get_user_information,
    "get_system_information": get_system_information,
    "get_inverter_information": get_inverter_information,
    "get_user_incidents": get_user_incidents
}

#---------------------------------------
# RAG Implementation
#---------------------------------------

class SolarAssistantRAG:
    """Optimized RAG implementation for Solar O&M assistant with conversation memory."""
    
    def __init__(self):
        """Initialize the RAG system."""
        self.embeddings = OpenAIEmbeddings(api_key=api_key, model="text-embedding-3-large")
        self.vector_store = None
        self.retriever = None
        self.llm = ChatOpenAI(api_key=api_key, model_name="gpt-4.1-mini", temperature=0.0)
        
        # Dictionary to store conversation memories
        self.memories = {}
        
        # Load the knowledge base data
        self._load_knowledge_base()
        
    def _load_knowledge_base(self) -> None:
        try:
            # Get Pinecone API key and host from environment variables
            pinecone_api_key = os.getenv("PINECONE_API_KEY")
            pinecone_host = os.getenv("PINECONE_HOST")
            
            # Initialize Pinecone with hardcoded namespace
            pc = Pinecone(api_key=pinecone_api_key)
            index = pc.Index(host=pinecone_host)
            # vector_store = PineconeVectorStore(index=index, embedding=self.embeddings, namespace="LDML")
            vector_store = PineconeVectorStore(index=index, embedding=self.embeddings, namespace="OM")
            self.vector_store = vector_store
            #   self.retriever = self.vector_store.as_retriever(search_type="similarity", search_kwargs={"k": 3})
            self.retriever = self.vector_store.as_retriever(search_type="similarity", search_kwargs={"k": 7})

        except Exception as e:
            print(f"Error loading knowledge base: {e}")
            # Create a simple fallback retriever that returns empty results
            self.vector_store = None
            self.retriever = None

    def _get_or_create_memory(self, user_id: str):
        """Get or create a conversation memory for a user."""
        # Extract the base user ID (before any underscores) to ensure memory persistence
        # even if the device ID changes between requests
       # base_user_id = user_id.split('_')[0] if user_id and '_' in user_id else user_id
        memory_key = user_id
        
        if memory_key not in self.memories:
            print(f"Creating new memory for user: {memory_key} (original ID: {user_id})")
            self.memories[memory_key] = ConversationBufferMemory(
                memory_key="chat_history",
                return_messages=True,
                output_key="answer"
            )
        else:
            print(f"Retrieved existing memory for user: {memory_key} (original ID: {user_id}) with {len(self.memories[memory_key].chat_memory.messages)} messages")
    
        return self.memories[memory_key]
    
    def query_with_openai_function_calling(self, query: str, user_id: str = "default_user", system_id: str = None, jwt_token: str = None, username: str = "Guest User") -> Dict[str, Any]:
        """
        Query using OpenAI's direct function calling.
        
        Args:
            query: The user's query
            user_id: Identifier for the user (already includes device ID)
            system_id: The ID of the solar system to use for function calls (if None, functions requiring system_id will be prompted)
            jwt_token: JWT token for API authentication
            username: User's actual name for personalized responses
            
        Returns:
            A dictionary with the response and any relevant documents
        """
        print(f"\n=== PROCESSING QUERY ===")
        print(f"User ID: {user_id}")
        print(f"System ID: {system_id}")
        print(f"Query: {query}")
        
        # Get or create memory for this user
        memory = self._get_or_create_memory(user_id)
        
        # Log memory state before adding new messages
        print(f"Memory before processing: {len(memory.chat_memory.messages)} messages")
        if memory.chat_memory.messages:
            print("Previous conversation:")
            for i, msg in enumerate(memory.chat_memory.messages):
                print(f"  [{i}] {msg.type}: {msg.content[:50]}...")
        
        # Prepare chat history for OpenAI format
        messages = []
        
        # Get current date for the system message
        current_date = datetime.now()
        formatted_date = current_date.strftime("%Y-%m-%d")
        current_day_of_week = current_date.strftime("%A")
        current_month = current_date.strftime("%B")
        current_year = current_date.strftime("%Y")
        
        # Add system message with current date and specific date ranges
        system_message = f"""You are a solar operations and maintenance expert specialized in Fronius inverters, and you work closely with the Lac des Mille Lacs First Nation (LDMLFN) community.
        
        IMPORTANT: You ONLY discuss solar energy topics. For any non-solar questions, respond: "I'm a solar energy specialist and can only help with solar systems, energy production, inverters, and maintenance. What can I help you with regarding your solar system?"

        SOLAR TOPICS ONLY: energy production, inverters, system status, maintenance, CO2 savings, earnings, troubleshooting, solar technology.

        EXAMPLE RESPONSES FOR OFF-TOPIC QUESTIONS:
        - "What's the weather like?" → "I'm a solar energy specialist and can only help with solar systems, energy production, inverters, and maintenance. However, I can tell you how weather affects your solar production if that would be helpful!"
        - "How do I cook pasta?" → "I'm a solar energy specialist and can only help with solar systems, energy production, inverters, and maintenance. Is there anything about your solar system I can help you with instead?"
        - "Tell me a joke" → "I'm a solar energy specialist focused on helping with solar systems and energy production. Is there anything about your solar system performance or maintenance I can assist with?"
        
        USER INFORMATION:
        - The user's name is {username}. If they ask about their name, greet them personally.
        - When appropriate, address them by name for a more personalized experience.
        
        ASSUMPTIONS:
        - Treat the user's community as Lac des Mille Lacs First Nation unless clearly stated otherwise.
        - When the user refers to "my community," "our energy system," "my location," or similar, interpret this as referring to LDMLFN.
        
        SYSTEM ID INSTRUCTIONS:
        - For any function that requires a system_id, use the system_id that is passed to you: {system_id if system_id else "None"}
        - If system_id is None and the user asks about energy production or CO2 savings, inform them that they need to select a system first.
        - Do NOT attempt to infer or extract a system_id from conversation history. Use ONLY the provided system_id value.
        
        CHART GENERATION:
        - When users ask to "show", "display", "graph", "chart", or "visualize" data, AUTOMATICALLY use the generate_chart_data function
        - IMPORTANT: Do NOT ask for permission - generate the chart immediately when users use these keywords
        - Keywords that trigger automatic chart generation: "show me", "display", "graph", "chart", "visualize", "plot"
        - Always provide a helpful text summary along with the chart data
        - For chart requests, be descriptive about what the chart will show
        - The chart will be automatically rendered by the frontend when chart_data is provided
        
        SOLAR.WEB API FORMAT OPTIMIZATION:
        Choose the optimal API format based on the user's request:
        
        YEARLY FORMAT (YYYY): Use for multi-year requests
        - "last 2 years" → start_date="2023", end_date="2024"
        - "2020 to 2023" → start_date="2020", end_date="2023"
        - "yearly trends" → Use yearly format for the requested period
        
        MONTHLY FORMAT (YYYY-MM): Use for monthly trends, quarters, year-parts
        - "first 6 months of 2025" → start_date="2025-01", end_date="2025-06"
        - "Q1 2024" → start_date="2024-01", end_date="2024-03"
        - "last 8 months" → start_date="2024-04", end_date="2024-12"
        - "March to August" → start_date="2024-03", end_date="2024-08"
        
        DAILY FORMAT (YYYY-MM-DD): Use for daily/weekly trends, short periods
        - "last 14 days" → start_date="2024-12-03", end_date="2024-12-17"
        - "this week" → start_date="2024-12-16", end_date="2024-12-22"
        - "December 1-15" → start_date="2024-12-01", end_date="2024-12-15"
        - "yesterday" → start_date="2024-12-16", end_date="2024-12-16"
        
        CRITICAL: start_date and end_date MUST use the SAME format (both YYYY, both YYYY-MM, or both YYYY-MM-DD)
        
        DATA HANDLING:
        - The API responses now include pre-calculated total values that you should use directly.
        - For energy production data, use the "total_energy_kwh" field for the total energy in kilowatt-hours.
        - For CO2 savings data, use the "total_co2_kg" field for the total CO2 saved in kilograms.
        - DO NOT attempt to recalculate these totals by summing the individual data points, as this may lead to inconsistent results.
        - When reporting multiple day values, present them using a consistent format with the same number of decimal places.
        - For financial calculations, multiply the total_energy_kwh value by $0.40 and present the result with 2 decimal places.
        
        TODAY'S DATE IS: {formatted_date} ({current_day_of_week}, {current_month} {current_date.day}, {current_year})
        
        DATE GUIDELINES:
        - Use today's date given above for any date calculations.
        - A week starts on Monday and ends on Sunday.
        - "This week" means from Monday of this week up to today.
        - "Last week" means from Monday to Sunday of the previous week.
        - "This month" means from the 1st of the current month to today.
        - "Last month" means the entire previous month.
        - "This year" means from January 1st of the current year to today.
        - "Last year" means the entire previous year.
        - When calling get_energy_production or get_co2_savings, convert these terms to actual dates.
        - The API requires dates in these formats:
          * For daily data: YYYY-MM-DD (e.g., "2023-05-15")
          * For monthly data: YYYY-MM (e.g., "2023-05")
          * For yearly data: YYYY (e.g., "2023")
        - Important: start_date and end_date must have the SAME format (both YYYY, both YYYY-MM, or both YYYY-MM-DD).

        USE THESE DATE FORMATS WITH API CALLS:
        - For specific days like "yesterday": Use YYYY-MM-DD format for both start_date and end_date
        - For specific months like "January 2023": Use YYYY-MM format for both start_date and end_date
        - For specific years like "2022": Use YYYY format for both start_date and end_date
        - For date ranges: Make sure both dates use the SAME format

        When users ask about financial earnings or money saved, use the get_energy_production function to get the energy data and then multiply the total_energy_kwh value by $0.40 to calculate the earnings. For example, if energy production is 100 kWh, earnings would be $40.00."""
        
        messages.append({"role": "system", "content": system_message})
        print('INSIDE FUNCTION CALLING')
        
        # Add conversation history
        
        if hasattr(memory, "chat_memory") and memory.chat_memory.messages:
            print(f"Adding {len(memory.chat_memory.messages)} messages from memory to conversation context")
            for msg in memory.chat_memory.messages:
                if hasattr(msg, "type") and msg.type == "human":
                    messages.append({"role": "user", "content": msg.content})
                elif hasattr(msg, "type") and msg.type == "ai":
                    messages.append({"role": "assistant", "content": msg.content})

        
        # Add current query
        messages.append({"role": "user", "content": query})
        
        print('MESSAGES: ', messages)
        print('MEMORY: ', memory.chat_memory.messages)
        
        try:
            # Call OpenAI API with function calling and updated specs
            response = openai_client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=messages,
                tools=FUNCTION_SPECS,
                temperature=0.0,
            )
            
            response_message = response.choices[0].message
            
                    # Check if the model wants to call a function
        source_documents = []
        chart_data = None
        dynamodb_queries = []
        if response_message.tool_calls:
            # Extract function calls
            messages.append({
                "role": "assistant",
                "tool_calls": response_message.tool_calls
                })
            
            # Process each function call
            tool_responses = []
            for tool_call in response_message.tool_calls:
                function_name = tool_call.function.name
                function_args = json.loads(tool_call.function.arguments)
                
                # Override system_id with the one provided in the request, if applicable
                if system_id and function_name in ["get_energy_production", "get_co2_savings", "get_flow_data", "generate_chart_data"]:
                    function_args["system_id"] = system_id
                    function_args["jwt_token"] = jwt_token  # Add JWT token to function args
                
                # For DynamoDB functions, add user_id if not present
                if function_name in ["get_user_information", "get_system_information", "get_inverter_information", "get_user_incidents"]:
                    if "user_id" not in function_args:
                        # Extract base user_id from the combined user_id
                        base_user_id = user_id.split('_')[0] if user_id and '_' in user_id else user_id
                        function_args["user_id"] = base_user_id
                    
                    # For system-related functions, add system_id if available
                    if function_name in ["get_system_information", "get_inverter_information"] and system_id:
                        function_args["system_id"] = system_id
                
                print(f"Calling function: {function_name} with args: {function_args}")
                
                # Execute the function
                function_to_call = FUNCTION_MAP.get(function_name)
                if function_to_call:
                    function_response = function_to_call(**function_args)
                    tool_responses.append({
                        "tool_call_id": tool_call.id,
                        "role": "tool",
                        "name": function_name,
                        "content": json.dumps(function_response)
                    })
                    
                    # Save source documents for RAG queries
                    if function_name == "search_vector_db" and isinstance(function_response, list):
                        source_documents = function_response
                    
                    # Save chart data for visualization
                    if function_name == "generate_chart_data" and isinstance(function_response, dict) and "error" not in function_response:
                        chart_data = function_response
                        logger.info(f"=== CHART DATA CAPTURED ===")
                        logger.info(f"Chart data type: {chart_data.get('data_type', 'unknown')}")
                        logger.info(f"Chart title: {chart_data.get('title', 'unknown')}")
                        logger.info(f"Chart data points: {len(chart_data.get('data_points', []))}")
                        logger.info(f"Chart total value: {chart_data.get('total_value', 'unknown')}")
                        logger.info(f"Chart unit: {chart_data.get('unit', 'unknown')}")
                    elif function_name == "generate_chart_data":
                        logger.warning(f"Chart data generation failed or returned error: {function_response}")
                    
                    # Track DynamoDB queries
                    if function_name in ["get_user_information", "get_system_information", "get_inverter_information", "get_user_incidents"]:
                        dynamodb_queries.append({
                            "function": function_name,
                            "query_type": function_args.get("data_type", "unknown"),
                            "user_id": function_args.get("user_id"),
                            "system_id": function_args.get("system_id"),
                            "success": "error" not in function_response
                        })
            
            # Add the function responses to the messages
            if tool_responses:
                messages.extend(tool_responses)
            
            # Call the model again with the function responses
            second_response = openai_client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=messages,
                temperature=0.0,
            )
            
            # Get the final response
            final_response = second_response.choices[0].message.content
            else:
                print("TOOL SELECTION: Model did not select any tool — simulating search_vector_db")

                # Simulate a call to search_vector_db
                function_name = "search_vector_db"
                function_args = {"query": query, "limit": 100}

                # Execute the function
                function_response = FUNCTION_MAP[function_name](**function_args)

                # Prepare documents - use correct format for the search results
                # This should match how the real search_vector_db function returns data
                source_documents = function_response  # Directly use the response as-is

                # Add a message with tool_calls (required before adding a tool message)
                tool_call_id = "fallback_call_" + str(hash(query))[:8]
                messages.append({
                    "role": "assistant",
                    "tool_calls": [
                        {
                            "id": tool_call_id,
                            "type": "function",
                            "function": {
                                "name": function_name,
                                "arguments": json.dumps(function_args)
                            }
                        }
                    ]
                })

                # Add the function response as a tool message
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "name": function_name,
                    "content": json.dumps(function_response)
                })

                # Call the model again with the function responses
                second_response = openai_client.chat.completions.create(
                    model="gpt-4.1-mini",
                    messages=messages,
                    temperature=0.0,
                )

                final_response = second_response.choices[0].message.content
            
            # Save the conversation
            print(f"Saving conversation to memory for user: {user_id}")
            # Instead of using save_context, directly add messages to chat_memory
            memory.chat_memory.add_user_message(query)
            memory.chat_memory.add_ai_message(final_response)
            
            # Log memory state after updating
            print(f"Memory after processing: {len(memory.chat_memory.messages)} messages")
            
            # Log final response structure
            logger.info(f"=== FINAL RESPONSE STRUCTURE ===")
            logger.info(f"Response text length: {len(final_response)} characters")
            logger.info(f"Source documents count: {len(source_documents)}")
            logger.info(f"Chart data present: {'Yes' if chart_data else 'No'}")
            if chart_data:
                logger.info(f"Chart data keys: {list(chart_data.keys()) if isinstance(chart_data, dict) else 'Not a dict'}")
            logger.info(f"=== END FINAL RESPONSE STRUCTURE ===")
            
            return {
                "response": final_response,
                "source_documents": source_documents,
                "chart_data": chart_data,
                "dynamodb_queries": dynamodb_queries
            }
            
        except Exception as e:
            print(f"Error in OpenAI function calling: {e}")
            return {
                "response": f"I encountered an error while processing your request: {str(e)}",
                "source_documents": [],
                "chart_data": None,
                "dynamodb_queries": []
            }

# Global RAG instance
_rag_instance = None

def get_rag_instance():
    """Get the singleton instance of the RAG system."""
    global _rag_instance
    if _rag_instance is None:
        try:
            _rag_instance = SolarAssistantRAG()
        except Exception as e:
            print(f"Error creating RAG instance: {e}")
    return _rag_instance

#---------------------------------------
# Chat Response Functions
#---------------------------------------

def get_chatbot_response(message: str, user_id: Optional[str] = None, system_id: Optional[str] = None, jwt_token: Optional[str] = None, username: Optional[str] = "Guest User") -> Dict[str, Any]:
    """
    Generate a response based on the user's message.
    
    Args:
        message: The user's message
        user_id: Optional user identifier for maintaining conversation context (already includes device ID)
        system_id: The ID of the solar system to use for function calls
        jwt_token: Optional JWT token for API authentication
        username: Optional user's name for personalized responses
    
    Returns:
        A dictionary with response and optional source documents
    """
    print('INSIDE CHATBOT RESPONSE')
    # Use a default user_id if none provided
    if not user_id:
        user_id = "default_user"
    
    # Initialize user context if it doesn't exist
    if user_id not in user_contexts:
        user_contexts[user_id] = {"current_system_id": None, "last_topic": None}
    
    # Update user context with system_id if provided
    if system_id:
        user_contexts[user_id]["current_system_id"] = system_id
    
    # Get the RAG instance
    rag = get_rag_instance()
    if not rag:
        return {"response": "The Solar Assistant is currently unavailable.", "source_documents": []}
    
    # Query the RAG system directly
    try:
        return rag.query_with_openai_function_calling(message, user_id, system_id, jwt_token, username)
    except Exception as e:
        print(f"Error in chatbot response: {e}")
        return {"response": f"I encountered an error while processing your request: {str(e)}", "source_documents": []}
def log_conversation_to_db(user_id: str, user_message: str, bot_response: str, system_id: str = None, chart_data: dict = None, dynamodb_queries: list = None):
    """Log chatbot conversation to DynamoDB"""
    if not table:
        logger.error("Cannot log conversation - database not available")
        return
    
    try:
        timestamp = datetime.now().isoformat()
        conversation_id = str(uuid.uuid4())
        
        # Create conversation log item
        log_item = {
            'PK': f'CHAT#{user_id}',
            'SK': f'CONVERSATION#{timestamp}',
            'user_message': user_message,
            'bot_response': bot_response,
            'system_id': system_id,
            'timestamp': timestamp,
            'conversation_id': conversation_id,
            'has_chart': chart_data is not None,
            'has_dynamodb_queries': dynamodb_queries is not None and len(dynamodb_queries) > 0
        }
        
        # Add chart data if present
        if chart_data:
            log_item['chart_data'] = {
                'data_type': chart_data.get('data_type', ''),
                'time_period': chart_data.get('time_period', ''),
                'total_value': Decimal(str(chart_data.get('total_value', 0))),  # Convert to Decimal
                'unit': chart_data.get('unit', ''),
                'data_points_count': len(chart_data.get('data_points', []))
            }
        
        # Add DynamoDB query logging if present
        if dynamodb_queries:
            log_item['dynamodb_queries'] = dynamodb_queries
        
        # Store in DynamoDB
        table.put_item(Item=log_item)
        logger.info(f"Logged conversation for user {user_id} with ID {conversation_id}")
        
    except Exception as e:
        logger.error(f"Failed to log conversation for user {user_id}: {str(e)}")

#---------------------------------------
# API Endpoints
#---------------------------------------

@app.get("/")
async def root():
    return {"message": "Welcome to the Solar O&M Chatbot API"}

@app.post("/api/chat", response_model=ChatResponse)
async def chat(chat_message: ChatMessage):
    try:
        """
        print("INSIDE MAIN")
        print("======== INCOMING CHAT REQUEST ========")
        print(f"Raw request data: {chat_message}")
        print(f"Message: {chat_message.message}")
        print(f"User ID: {chat_message.user_id}")
        print(f"Username: {chat_message.username}")
        print(f"JWT: {chat_message.jwtToken}")
        print("======================================")
        """
        
        # Extract user_id from the request
        user_id = chat_message.user_id or "default_user"
        
        # Extract system_id from the combined ID if present
        # Format is expected to be: userId_deviceId_systemId
        system_id = None
        parts = user_id.split('_')
        if len(parts) >= 3:
            # The last part should be the system_id
            system_id = parts[-1]
            # For memory persistence, we'll use just the base user ID
            # This is handled by _get_or_create_memory
        
        # Get response from chatbot
        result = get_chatbot_response(
            chat_message.message, 
            user_id, 
            system_id, 
            chat_message.jwtToken,
            chat_message.username
        )
        
        # Log the conversation to DynamoDB
        log_conversation_to_db(
            user_id=user_id,
            user_message=chat_message.message,
            bot_response=result["response"],
            system_id=system_id,
            chart_data=result.get("chart_data"),
            dynamodb_queries=result.get("dynamodb_queries", [])
        )
        
        # Process source documents if present
        source_documents = []
        if result.get("source_documents"):
            for doc in result["source_documents"]:
                source_documents.append(
                    SourceDocument(
                        content=doc.get("content", doc.page_content if hasattr(doc, "page_content") else ""),
                        metadata=doc.get("metadata", {})
                    )
                )
        
        return ChatResponse(
            response=result["response"],
            source_documents=source_documents,
            chart_data=result.get("chart_data")
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
async def health_check():
    # Check if RAG is available
    rag_available = get_rag_instance() is not None
    return {
        "status": "healthy",
        "rag_available": rag_available
    }


# AWS Lambda handler
handler = Mangum(app) 
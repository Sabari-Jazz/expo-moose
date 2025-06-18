"""
Solar O&M Chatbot API with Langchain RAG Pipeline
"""
import os
import json
from typing import Dict, List, Optional, Any
import re
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn
from dotenv import load_dotenv
import requests
from datetime import datetime, timedelta
from mangum import Mangum  # Add Mangum import
import boto3
from botocore.exceptions import ClientError
import logging

# Langchain imports

from langchain_openai import OpenAIEmbeddings
from langchain.docstore.document import Document
from langchain.prompts import PromptTemplate
from langchain.chains import LLMChain
from langchain_openai import ChatOpenAI
from langchain.memory import ConversationBufferMemory
from langchain.chains import ConversationalRetrievalChain
from langchain_pinecone import PineconeVectorStore
from pinecone.grpc import PineconeGRPC as Pinecone
from pinecone import ServerlessSpec

# Import OpenAI for direct function calling
import openai
from openai import OpenAI
from decimal import Decimal

# Load environment variables
load_dotenv()

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
    title="Solar O&M Chatbot API",
    description="API for a chatbot specialized in solar operations and maintenance",
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
# Pydantic Models
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

class ChatResponse(BaseModel):
    """Response from the chatbot"""
    response: str
    source_documents: Optional[List[SourceDocument]] = None

# Add function schema models
class SearchVectorDBParams(BaseModel):
    """Parameters for the search_vector_db function"""
    query: str = Field(description="The query to search for in the vector database")
    limit: Optional[int] = Field(default=3, description="The maximum number of results to return")

class GetEnergyProductionParams(BaseModel):
    """Parameters for the get_energy_production function"""
    system_id: str = Field(description="The ID of the system to get data for")
    period: str = Field(description="The time period to get data for (today, week, month, year, custom)")
    start_date: Optional[str] = Field(default=None, description="Start date for custom period (format: YYYY-MM-DD)")
    duration: Optional[int] = Field(default=None, description="Duration in days for custom period")

class GetCO2SavingsParams(BaseModel):
    """Parameters for the get_co2_savings function"""
    system_id: str = Field(description="The ID of the system to get data for")
    period: str = Field(description="The time period to get data for (today, week, month, year, custom)")
    start_date: Optional[str] = Field(default=None, description="Start date for custom period (format: YYYY-MM-DD)")
    duration: Optional[int] = Field(default=None, description="Duration in days for custom period")

# User Management Models
class UserRegistration(BaseModel):
    """User registration data"""
    user_id: str = Field(description="Unique user identifier")
    name: str = Field(description="User's full name")
    username: str = Field(description="Username")
    email: str = Field(description="User's email address")
    role: str = Field(default="user", description="User role (user, admin)")

class DeviceRegistration(BaseModel):
    """Device registration for push notifications"""
    user_id: str = Field(description="User ID owning this device")
    device_id: str = Field(description="Unique device identifier")
    expo_push_token: str = Field(description="Expo push notification token")
    platform: str = Field(description="Device platform (ios, android)")

class SystemUserLink(BaseModel):
    """Link a user to a solar system"""
    user_id: str = Field(description="User ID")
    system_id: str = Field(description="Solar system ID")

class UserResponse(BaseModel):
    """Response for user operations"""
    success: bool
    message: str
    user_id: Optional[str] = None

class DeviceResponse(BaseModel):
    """Response for device operations"""
    success: bool
    message: str
    device_id: Optional[str] = None

class SystemLinkResponse(BaseModel):
    """Response for system linking operations"""
    success: bool
    message: str
    links_count: Optional[int] = None

#---------------------------------------
# Knowledge Base
#---------------------------------------

# Sample solar O&M knowledge base


# Sample user context to maintain conversation state
user_contexts: Dict[str, Dict] = {}

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
    """
    Gets the realtime power flow data for a specific solar system from the Solar.web API.
    
    Args:
        system_id: The ID of the system to get data for
        jwt_token: JWT token for API authentication
        
    Returns:
        A dictionary with flow data including system status and power information
    """
    
    print(f"Fetching flow data for system {system_id}")
    
    # Validate system_id
    if not system_id:
        return {
            "error": "No system ID provided. Please select a system before querying flow data.",
            "system_id_required": True
        }
    
    # Base URL for the Solar.web API
    base_url = f"https://api.solarweb.com/swqapi/pvsystems/{system_id}/flowdata"
    
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
        print(f"Calling Solar.web API for flow data: {base_url}")
        response = requests.get(
            base_url, 
            headers=headers
        )
        
        # Check if the request was successful
        if response.status_code == 200:
            data = response.json()
            print(f"API call successful, received flow data: {data}")
            return data
        else:
            print(f"API call failed with status code {response.status_code}: {response.text}")
            
            # Fall back to mock data if the API call fails
            print("Using mock flow data as fallback")
            mock_data = {
                "pvSystemId": system_id,
                "status": {
                    "isOnline": True,
                    "battMode": "1.0"
                },
                "data": {
                    "logDateTime": datetime.now().isoformat(),
                    "channels": [
                        {
                            "channelName": "PowerFeedIn",
                            "channelType": "Power",
                            "unit": "W",
                            "value": -496.01
                        },
                        {
                            "channelName": "PowerLoad",
                            "channelType": "Power",
                            "unit": "W",
                            "value": -186.89
                        },
                        {
                            "channelName": "PowerBattCharge",
                            "channelType": "Power",
                            "unit": "W",
                            "value": 0
                        },
                        {
                            "channelName": "PowerPV",
                            "channelType": "Power",
                            "unit": "W",
                            "value": 1682.9
                        },
                        {
                            "channelName": "PowerOhmpilot",
                            "channelType": "Power",
                            "unit": "W",
                            "value": None
                        },
                        {
                            "channelName": "BattSOC",
                            "channelType": "Percent",
                            "unit": "%",
                            "value": 99
                        },
                        {
                            "channelName": "RateSelfSufficiency",
                            "channelType": "Percent",
                            "unit": "%",
                            "value": 100
                        },
                        {
                            "channelName": "RateSelfConsumption",
                            "channelType": "Percent",
                            "unit": "%",
                            "value": 64.58
                        },
                        {
                            "channelName": "PowerEVCTotal",
                            "channelType": "Power",
                            "unit": "W",
                            "value": -1000.0
                        }
                    ]
                }
            }
            return mock_data
    except Exception as e:
        print(f"Error fetching flow data: {e}")
        return {"error": f"Failed to fetch flow data: {str(e)}"}

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

# Function to update function specs with current dates
FUNCTION_SPECS =  [
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
        }
    ]

# Function map for executing called functions
FUNCTION_MAP = {
    "search_vector_db": search_vector_db,
    "get_energy_production": get_energy_production,
    "get_co2_savings": get_co2_savings,
    "get_flow_data": get_flow_data
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
                    if system_id and function_name in ["get_energy_production", "get_co2_savings", "get_flow_data"]:
                        function_args["system_id"] = system_id
                        function_args["jwt_token"] = jwt_token  # Add JWT token to function args
                    
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
            
            return {
                "response": final_response,
                "source_documents": source_documents
            }
            
        except Exception as e:
            print(f"Error in OpenAI function calling: {e}")
            return {
                "response": f"I encountered an error while processing your request: {str(e)}",
                "source_documents": []
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

#---------------------------------------
# API Endpoints
#---------------------------------------

@app.get("/")
async def root():
    return {"message": "Welcome to the Solar O&M Chatbot API"}

@app.post("/chat", response_model=ChatResponse)
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
            source_documents=source_documents
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

#---------------------------------------
# DynamoDB Helper Functions
#---------------------------------------


def register_device_in_db(device_data: DeviceRegistration) -> DeviceResponse:
    """Register a device for push notifications in DynamoDB"""
    if not table:
        return DeviceResponse(success=False, message="Database not available")
    
    try:
        # Create device record in the exact format requested
        device_item = {
            'PK': f'User#{device_data.user_id}',
            'SK': f'Device#{device_data.device_id}',
            'pushToken': device_data.expo_push_token,
            'platform': device_data.platform,
            'createdAt': datetime.utcnow().isoformat() + 'Z'
        }
        
        # Upsert device (allow updates)
        table.put_item(Item=device_item)
        
        return DeviceResponse(
            success=True,
            message=f"Device {device_data.device_id} registered successfully",
            device_id=device_data.device_id
        )
        
    except Exception as e:
        return DeviceResponse(
            success=False,
            message=f"Error registering device: {str(e)}"
        )

def delete_device_from_db(user_id: str, device_id: str) -> DeviceResponse:
    """Delete a device registration from DynamoDB"""
    if not table:
        return DeviceResponse(success=False, message="Database not available")
    
    try:
        # Delete device record using exact PK/SK format
        table.delete_item(
            Key={
                'PK': f'User#{user_id}',
                'SK': f'Device#{device_id}'
            }
        )
        
        return DeviceResponse(
            success=True,
            message=f"Device {device_id} deleted successfully",
            device_id=device_id
        )
        
    except Exception as e:
        return DeviceResponse(
            success=False,
            message=f"Error deleting device: {str(e)}"
        )


def get_user_systems(user_id: str) -> List[str]:
    """Get list of system IDs accessible to a user"""
    if not table:
        return []
    
    try:
        # First, get the user profile to check their role
        profile_response = table.get_item(
            Key={
                'PK': f'User#{user_id}',
                'SK': 'PROFILE'
            }
        )
        
        # Check if user profile exists and extract role
        user_role = "user"  # default role
        if 'Item' in profile_response:
            user_role = profile_response['Item'].get('role', 'user')
        
        # If user is admin, return all systems
        if user_role == "admin":
            print(f"User {user_id} is admin, fetching all systems")
            # Query for all system profiles (PK begins with "System#" and SK = "PROFILE")
            response = table.scan(
                FilterExpression=boto3.dynamodb.conditions.Attr('PK').begins_with('System#') & 
                               boto3.dynamodb.conditions.Attr('SK').eq('PROFILE')
            )
            
            # Extract systemId from each system profile
            system_ids = []
            for item in response.get('Items', []):
                # Extract system ID from PK (remove "System#" prefix)
                system_id = item['PK'].replace('System#', '')
                system_ids.append(system_id)
            
            print(f"Admin user {user_id} has access to {len(system_ids)} systems")
            return system_ids
        
        else:
            # Regular user - use existing logic
            print(f"User {user_id} is regular user, fetching linked systems")
            response = table.query(
                KeyConditionExpression='PK = :pk AND begins_with(SK, :sk)',
                ExpressionAttributeValues={
                    ':pk': f'User#{user_id}',
                    ':sk': 'System#'
                }
            )
            
            system_ids = [item['systemId'] for item in response.get('Items', [])]
            print(f"Regular user {user_id} has access to {len(system_ids)} systems")
            return system_ids
        
    except Exception as e:
        print(f"Error getting user systems: {str(e)}")
        return []

def get_user_profile(user_id: str) -> Dict[str, Any]:
    """Get user profile data from DynamoDB"""
    if not table:
        return {"error": "Database not available"}
    
    try:
        response = table.get_item(
            Key={
                'PK': f'User#{user_id}',
                'SK': 'PROFILE'
            }
        )
        
        if 'Item' in response:
            item = response['Item']
            return {
                'email': item.get('email', ''),
                'name': item.get('name', ''),
                'role': item.get('role', 'user'),
                'username': item.get('username', ''),
                'userId': item.get('userId', user_id)
            }
        else:
            return {"error": f"User profile not found for user_id: {user_id}"}
            
    except Exception as e:
        print(f"Error getting user profile: {str(e)}")
        return {"error": str(e)}


# CONSOLIDATED DATA FUNCTIONS

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

#---------------------------------------
# API Routes
#---------------------------------------



@app.get("/api/user/{user_id}/profile")
async def get_user_profile_endpoint(user_id: str):
    """
    Get user profile data from DynamoDB
    """
    logger.info(f"GET /api/user/{user_id}/profile")
    
    try:
        profile_data = get_user_profile(user_id)
        logger.info(f"Profile data result: {profile_data}")
        
        if "error" in profile_data:
            raise HTTPException(status_code=404, detail=profile_data["error"])
        
        return profile_data
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_user_profile_endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/api/user/{user_id}/systems")
async def get_user_systems_endpoint(user_id: str):
    """
    Get user's accessible systems from DynamoDB
    """
    logger.info(f"GET /api/user/{user_id}/systems")
    
    try:
        systems_data = get_user_systems(user_id)
        logger.info(f"Systems data result: Found {len(systems_data)} systems")
        
        return systems_data
        
    except Exception as e:
        logger.error(f"Error in get_user_systems_endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/api/device/register", response_model=DeviceResponse)
async def register_device_endpoint(device_data: DeviceRegistration):
    """
    Register a device for push notifications in DynamoDB
    """
    logger.info(f"POST /api/device/register - User: {device_data.user_id}, Device: {device_data.device_id}")
    
    try:
        result = register_device_in_db(device_data)
        logger.info(f"Device registration result: {result.message}")
        
        if not result.success:
            raise HTTPException(status_code=400, detail=result.message)
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in register_device_endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.delete("/api/device/{user_id}/{device_id}", response_model=DeviceResponse)
async def delete_device_endpoint(user_id: str, device_id: str):
    """
    Delete a device registration when user logs out
    """
    logger.info(f"DELETE /api/device/{user_id}/{device_id}")
    
    try:
        result = delete_device_from_db(user_id, device_id)
        logger.info(f"Device deletion result: {result.message}")
        
        if not result.success:
            raise HTTPException(status_code=400, detail=result.message)
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in delete_device_endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

# Create a handler for AWS Lambda
handler = Mangum(app)

# Keep the local development server
if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
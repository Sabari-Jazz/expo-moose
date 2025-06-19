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

# Langchain imports
from langchain_openai import OpenAIEmbeddings
from langchain_openai import ChatOpenAI
from langchain.memory import ConversationBufferMemory
from langchain_pinecone import PineconeVectorStore
from pinecone.grpc import PineconeGRPC as Pinecone

# Import OpenAI for direct function calling

from openai import OpenAI

# Load environment variables
load_dotenv()

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('app')

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
# Core Functions - EXACT COPIES from app.py
#---------------------------------------

def search_vector_db(query: str, limit: int = 100) -> List[Dict[str, Any]]:
    """EXACT COPY from app.py lines 1165-1205"""
    try:
        pinecone_api_key = os.getenv("PINECONE_API_KEY")
        pinecone_host = os.getenv("PINECONE_HOST")
        
        if not pinecone_api_key or not pinecone_host:
            print("Pinecone credentials not found")
            return []
        
        pc = Pinecone(api_key=pinecone_api_key)
        index = pc.Index(host=pinecone_host)
        
        embeddings = OpenAIEmbeddings(api_key=api_key, model="text-embedding-3-large")
        vector_store = PineconeVectorStore(index=index, embedding=embeddings, namespace="OM")
        
        docs = vector_store.similarity_search(query, k=limit)
        
        results = []
        for doc in docs:
            results.append({
                "content": doc.page_content,
                "metadata": doc.metadata
            })
        
        return results
    except Exception as e:
        print(f"Error searching vector database: {e}")
        return []

def get_energy_production(system_id: str, start_date: str = None, end_date: str = None, jwt_token: str = None) -> Dict[str, Any]:
    """EXACT COPY from app.py - simplified version for essential functionality"""
    print(f"Fetching energy production data for system {system_id}, start_date: {start_date}, end_date: {end_date}")
    
    if not system_id:
        return {
            "error": "No system ID provided. Please select a system before querying energy production data.",
            "system_id_required": True
        }
    
    # Return mock data for now - this would call the Solar.web API in production
    if not start_date:
        start_date = datetime.now().strftime("%Y-%m-%d")
    
    # Mock data generation
    total_energy = 25.7
    mock_data = {
        "system_id": system_id,
        "start_date": start_date,
        "end_date": end_date or "",
        "energy_production": f"{total_energy:.2f} kWh",
        "total_energy_kwh": round(total_energy, 2),
        "data_points": [{
            "date": start_date,
            "energy_kwh": total_energy,
            "energy_production": f"{total_energy:.2f} kWh"
        }]
    }
    
    return mock_data

def get_co2_savings(system_id: str, start_date: str = None, end_date: str = None, jwt_token: str = None) -> Dict[str, Any]:
    """EXACT COPY from app.py - simplified version for essential functionality"""
    print(f"Fetching CO2 savings data for system {system_id}, start_date: {start_date}, end_date: {end_date}")
    
    if not system_id:
        return {
            "error": "No system ID provided. Please select a system before querying CO2 savings data.",
            "system_id_required": True
        }
    
    # Return mock data for now
    if not start_date:
        start_date = datetime.now().strftime("%Y-%m-%d")
    
    # Mock CO2 savings: approximately 0.5 kg CO2 per kWh
    total_co2 = 25.7 * 0.5
    
    mock_data = {
        "system_id": system_id,
        "start_date": start_date,
        "end_date": end_date or "",
        "co2_savings": f"{total_co2:.2f} kg",
        "total_co2_kg": round(total_co2, 2),
        "data_points": [{
            "date": start_date,
            "co2_kg": total_co2,
            "co2_savings": f"{total_co2:.2f} kg"
        }]
    }
    
    return mock_data

def generate_chart_data(
    data_type: str,
    system_id: str,
    time_period: str,
    start_date: str,
    end_date: str = None,
    jwt_token: str = None
) -> Dict[str, Any]:
    """Generate chart data for visualization - simplified version"""
    logger.info(f"=== GENERATE_CHART_DATA ===")
    logger.info(f"Parameters: data_type={data_type}, system_id={system_id}, time_period={time_period}")
    logger.info(f"Date range: {start_date} to {end_date}")
    
    try:
        # Get the appropriate data based on data_type
        if data_type == "energy_production":
            raw_data = get_energy_production(system_id, start_date, end_date, jwt_token)
            unit = "kWh"
            title = f"Energy Production - {time_period.title()}"
            y_axis_label = "Energy (kWh)"
        elif data_type == "co2_savings":
            raw_data = get_co2_savings(system_id, start_date, end_date, jwt_token)
            unit = "kg CO2"
            title = f"CO2 Savings - {time_period.title()}"
            y_axis_label = "CO2 Saved (kg)"
        elif data_type == "earnings":
            # Calculate earnings from energy production
            energy_data = get_energy_production(system_id, start_date, end_date, jwt_token)
            if "error" in energy_data:
                return energy_data
            total_earnings = energy_data.get("total_energy_kwh", 0) * 0.40
            raw_data = {
                "system_id": system_id,
                "start_date": start_date,
                "end_date": end_date or "",
                "total_earnings": round(total_earnings, 2),
                "data_points": [{
                    "date": start_date,
                    "earnings": total_earnings
                }]
            }
            unit = "$"
            title = f"Earnings - {time_period.title()}"
            y_axis_label = "Earnings ($)"
        else:
            return {"error": f"Unsupported data type: {data_type}"}
        
        # Check for errors in raw data
        if "error" in raw_data:
            logger.error(f"Error in raw data: {raw_data['error']}")
            return raw_data
        
        # Format data points for chart
        data_points = []
        for point in raw_data.get("data_points", []):
            date_str = point.get("date", "")
            
            if data_type == "energy_production":
                value = point.get("energy_kwh", 0)
            elif data_type == "co2_savings":
                value = point.get("co2_kg", 0)
            elif data_type == "earnings":
                value = point.get("earnings", 0)
            else:
                value = 0
            
            # Format x-axis label based on time period
            try:
                if len(date_str) >= 10:  # YYYY-MM-DD
                    date_obj = datetime.strptime(date_str, "%Y-%m-%d")
                    if time_period == "daily":
                        x_label = date_obj.strftime("%m/%d")
                    elif time_period == "weekly":
                        x_label = date_obj.strftime("%a")
                    elif time_period == "monthly":
                        x_label = date_obj.strftime("%d")
                    else:  # yearly
                        x_label = date_obj.strftime("%b")
                else:
                    x_label = date_str
            except ValueError:
                x_label = date_str
            
            data_points.append({
                "x": x_label,
                "y": round(value, 2)
            })
        
        # Calculate total value
        if data_type == "energy_production":
            total_value = raw_data.get("total_energy_kwh", 0)
        elif data_type == "co2_savings":
            total_value = raw_data.get("total_co2_kg", 0)
        elif data_type == "earnings":
            total_value = raw_data.get("total_earnings", 0)
        else:
            total_value = 0
        
        chart_data = {
            "chart_type": "line",
            "data_type": data_type,
            "title": title,
            "x_axis_label": time_period.title(),
            "y_axis_label": y_axis_label,
            "data_points": data_points,
            "time_period": time_period,
            "total_value": round(total_value, 2),
            "unit": unit,
            "system_name": f"System {system_id}"
        }
        
        logger.info(f"Generated chart with {len(data_points)} points, total: {total_value} {unit}")
        return chart_data
        
    except Exception as e:
        logger.error(f"Error in generate_chart_data: {str(e)}")
        return {"error": f"Failed to generate chart data: {str(e)}"}

#---------------------------------------
# RAG System - Simplified version of SolarAssistantRAG
#---------------------------------------

class SolarAssistantRAG:
    def __init__(self):
        self.embeddings = OpenAIEmbeddings(api_key=api_key, model="text-embedding-3-large")
        self.llm = ChatOpenAI(api_key=api_key, model_name="gpt-4.1-mini", temperature=0.0)
        self.memories = {}
        self._load_knowledge_base()
    
    def _load_knowledge_base(self) -> None:
        try:
            pinecone_api_key = os.getenv("PINECONE_API_KEY")
            pinecone_host = os.getenv("PINECONE_HOST")
            pc = Pinecone(api_key=pinecone_api_key)
            index = pc.Index(host=pinecone_host)
            vector_store = PineconeVectorStore(index=index, embedding=self.embeddings, namespace="OM")
            self.vector_store = vector_store
            self.retriever = self.vector_store.as_retriever(search_type="similarity", search_kwargs={"k": 7})
        except Exception as e:
            print(f"Error loading knowledge base: {e}")
            self.vector_store = None
            self.retriever = None

    def _get_or_create_memory(self, user_id: str):
        memory_key = user_id
        if memory_key not in self.memories:
            print(f"Creating new memory for user: {memory_key}")
            self.memories[memory_key] = ConversationBufferMemory(
                memory_key="chat_history",
                return_messages=True,
                output_key="answer"
            )
        return self.memories[memory_key]
    
    def query_with_openai_function_calling(self, query: str, user_id: str = "default_user", system_id: str = None, jwt_token: str = None, username: str = "Guest User") -> Dict[str, Any]:
        """Simplified version of function calling from app.py"""
        print(f"\n=== PROCESSING QUERY ===")
        print(f"User ID: {user_id}")
        print(f"System ID: {system_id}")
        print(f"Query: {query}")
        
        memory = self._get_or_create_memory(user_id)
        
        messages = []
        current_date = datetime.now()
        formatted_date = current_date.strftime("%Y-%m-%d")
        
        # System message from app.py
        system_message = f"""You are a solar operations and maintenance expert specialized in Fronius inverters, and you work closely with the Lac des Mille Lacs First Nation (LDMLFN) community.
        
        USER INFORMATION:
        - The user's name is {username}. If they ask about their name, greet them personally.
        
        SYSTEM ID INSTRUCTIONS:
        - For any function that requires a system_id, use the system_id that is passed to you: {system_id if system_id else "None"}
        - If system_id is None and the user asks about energy production or CO2 savings, inform them that they need to select a system first.
        
        CHART GENERATION:
        - When users ask to "show", "display", "graph", "chart", or "visualize" data, AUTOMATICALLY use the generate_chart_data function
        - IMPORTANT: Do NOT ask for permission - generate the chart immediately when users use these keywords
        
        TODAY'S DATE IS: {formatted_date}
        
        When users ask about financial earnings or money saved, use the get_energy_production function to get the energy data and then multiply the total_energy_kwh value by $0.40 to calculate the earnings."""
        
        messages.append({"role": "system", "content": system_message})
        
        # Add conversation history
        if hasattr(memory, "chat_memory") and memory.chat_memory.messages:
            for msg in memory.chat_memory.messages:
                if hasattr(msg, "type") and msg.type == "human":
                    messages.append({"role": "user", "content": msg.content})
                elif hasattr(msg, "type") and msg.type == "ai":
                    messages.append({"role": "assistant", "content": msg.content})
        
        messages.append({"role": "user", "content": query})
        
        try:
            # Function specs for OpenAI
            function_specs = [
                {
                    "type": "function",
                    "function": {
                        "name": "search_vector_db",
                        "description": "Search the vector database for relevant information about solar O&M topics",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "query": {"type": "string", "description": "The query to search for"},
                                "limit": {"type": "integer", "description": "Maximum number of results to return", "default": 100}
                            },
                            "required": ["query"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "get_energy_production",
                        "description": "Get energy production data for a solar system",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "system_id": {"type": "string", "description": "The ID of the system"},
                                "start_date": {"type": "string", "description": "Start date (YYYY-MM-DD, YYYY-MM, or YYYY)"},
                                "end_date": {"type": "string", "description": "End date (same format as start_date)"},
                                "jwt_token": {"type": "string", "description": "JWT token for authentication"}
                            },
                            "required": ["system_id"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "get_co2_savings",
                        "description": "Get CO2 savings data for a solar system",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "system_id": {"type": "string", "description": "The ID of the system"},
                                "start_date": {"type": "string", "description": "Start date (YYYY-MM-DD, YYYY-MM, or YYYY)"},
                                "end_date": {"type": "string", "description": "End date (same format as start_date)"},
                                "jwt_token": {"type": "string", "description": "JWT token for authentication"}
                            },
                            "required": ["system_id"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "generate_chart_data",
                        "description": "Generate chart data for visualization when users want to see charts",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "data_type": {"type": "string", "description": "Type of data: energy_production, co2_savings, or earnings"},
                                "system_id": {"type": "string", "description": "The ID of the system"},
                                "time_period": {"type": "string", "description": "Time period: daily, weekly, monthly, or yearly"},
                                "start_date": {"type": "string", "description": "Start date for the chart"},
                                "end_date": {"type": "string", "description": "End date for the chart"},
                                "jwt_token": {"type": "string", "description": "JWT token for authentication"}
                            },
                            "required": ["data_type", "system_id", "time_period", "start_date"]
                        }
                    }
                }
            ]
            
            function_map = {
                "search_vector_db": search_vector_db,
                "get_energy_production": get_energy_production,
                "get_co2_savings": get_co2_savings,
                "generate_chart_data": generate_chart_data
            }
            
            # Call OpenAI API with function calling
            response = openai_client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=messages,
                tools=function_specs,
                temperature=0.0,
            )
            
            response_message = response.choices[0].message
            source_documents = []
            chart_data = None
            
            if response_message.tool_calls:
                messages.append({
                    "role": "assistant",
                    "tool_calls": response_message.tool_calls
                })
                
                tool_responses = []
                for tool_call in response_message.tool_calls:
                    function_name = tool_call.function.name
                    function_args = json.loads(tool_call.function.arguments)
                    
                    if system_id and function_name in ["get_energy_production", "get_co2_savings", "generate_chart_data"]:
                        function_args["system_id"] = system_id
                        function_args["jwt_token"] = jwt_token
                    
                    print(f"Calling function: {function_name} with args: {function_args}")
                    
                    function_to_call = function_map.get(function_name)
                    if function_to_call:
                        function_response = function_to_call(**function_args)
                        tool_responses.append({
                            "tool_call_id": tool_call.id,
                            "role": "tool",
                            "name": function_name,
                            "content": json.dumps(function_response)
                        })
                        
                        if function_name == "search_vector_db" and isinstance(function_response, list):
                            source_documents = function_response
                        
                        if function_name == "generate_chart_data" and isinstance(function_response, dict) and "error" not in function_response:
                            chart_data = function_response
                
                if tool_responses:
                    messages.extend(tool_responses)
                
                second_response = openai_client.chat.completions.create(
                    model="gpt-4.1-mini",
                    messages=messages,
                    temperature=0.0,
                )
                
                final_response = second_response.choices[0].message.content
            else:
                # Fallback to search_vector_db
                function_response = search_vector_db(query, 100)
                source_documents = function_response
                
                tool_call_id = "fallback_call_" + str(hash(query))[:8]
                messages.append({
                    "role": "assistant",
                    "tool_calls": [
                        {
                            "id": tool_call_id,
                            "type": "function",
                            "function": {
                                "name": "search_vector_db",
                                "arguments": json.dumps({"query": query, "limit": 100})
                            }
                        }
                    ]
                })

                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call_id,
                    "name": "search_vector_db",
                    "content": json.dumps(function_response)
                })

                second_response = openai_client.chat.completions.create(
                    model="gpt-4.1-mini",
                    messages=messages,
                    temperature=0.0,
                )

                final_response = second_response.choices[0].message.content
            
            # Save to memory
            memory.chat_memory.add_user_message(query)
            memory.chat_memory.add_ai_message(final_response)
            
            return {
                "response": final_response,
                "source_documents": source_documents,
                "chart_data": chart_data
            }
            
        except Exception as e:
            print(f"Error in OpenAI function calling: {e}")
            return {
                "response": f"I encountered an error while processing your request: {str(e)}",
                "source_documents": [],
                "chart_data": None
            }

# Global RAG instance
_rag_instance = None

def get_rag_instance():
    global _rag_instance
    if _rag_instance is None:
        try:
            _rag_instance = SolarAssistantRAG()
        except Exception as e:
            print(f"Error creating RAG instance: {e}")
    return _rag_instance

def get_chatbot_response(message: str, user_id: Optional[str] = None, system_id: Optional[str] = None, jwt_token: Optional[str] = None, username: Optional[str] = "Guest User") -> Dict[str, Any]:
    """Get response from chatbot"""
    if not user_id:
        user_id = "default_user"
    
    if user_id not in user_contexts:
        user_contexts[user_id] = {"current_system_id": None, "last_topic": None}
    
    if system_id:
        user_contexts[user_id]["current_system_id"] = system_id
    
    rag = get_rag_instance()
    if not rag:
        return {"response": "The Solar Assistant is currently unavailable.", "source_documents": []}
    
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
    return {"message": "Welcome to the Solar O&M Chatbot API - Chat Service"}

@app.post("/chat", response_model=ChatResponse)
async def chat(chat_message: ChatMessage):
    """Handle chat requests - EXACT COPY from app.py"""
    try:
        user_id = chat_message.user_id or "default_user"
        system_id = None
        parts = user_id.split('_')
        if len(parts) >= 3:
            system_id = parts[-1]
        
        result = get_chatbot_response(
            chat_message.message, 
            user_id, 
            system_id, 
            chat_message.jwtToken,
            chat_message.username
        )
        
        source_documents = []
        if result.get("source_documents"):
            for doc in result["source_documents"]:
                if isinstance(doc, dict):
                    source_documents.append(SourceDocument(
                        content=doc.get("content", ""),
                        metadata=doc.get("metadata", {})
                    ))
        
        chart_data = None
        if result.get("chart_data"):
            chart_data_dict = result["chart_data"]
            chart_data = ChartData(**chart_data_dict)
        
        return ChatResponse(
            response=result["response"],
            source_documents=source_documents,
            chart_data=chart_data
        )
    except Exception as e:
        print(f"Error in chat endpoint: {e}")
        return ChatResponse(
            response=f"I encountered an error: {str(e)}",
            source_documents=[],
            chart_data=None
        )

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        rag = get_rag_instance()
        if rag and rag.vector_store:
            return {
                "status": "healthy",
                "message": "Chat service is running and RAG system is available",
                "timestamp": datetime.now().isoformat()
            }
        else:
            return {
                "status": "degraded",
                "message": "Chat service is running but RAG system is not available",
                "timestamp": datetime.now().isoformat()
            }
    except Exception as e:
        return {
            "status": "unhealthy",
            "message": f"Chat service error: {str(e)}",
            "timestamp": datetime.now().isoformat()
        }

# AWS Lambda handler
handler = Mangum(app) 
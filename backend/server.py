from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import asyncio
import json
import base64
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime
import pandas as pd
import sqlite3
import plotly.graph_objects as go
import plotly.express as px
from io import BytesIO
import google.generativeai as genai

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Configure Gemini API
genai.configure(api_key=os.environ['GEMINI_API_KEY'])

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# SQLite setup
DATABASE_PATH = ROOT_DIR.parent / "data" / "ai_sql_agent.db"

def init_database():
    """Initialize SQLite database from CSV files"""
    try:
        conn = sqlite3.connect(DATABASE_PATH)
        
        # Load CSV files
        data_dir = ROOT_DIR.parent / "data"
        
        # Load ad_sales.csv
        ad_sales_df = pd.read_csv(data_dir / "ad_sales.csv")
        ad_sales_df.to_sql('ad_sales_table', conn, if_exists='replace', index=False)
        
        # Load total_sales.csv
        total_sales_df = pd.read_csv(data_dir / "total_sales.csv")
        total_sales_df.to_sql('total_sales_table', conn, if_exists='replace', index=False)
        
        # Load eligibility.csv
        eligibility_df = pd.read_csv(data_dir / "eligibility.csv")
        eligibility_df.to_sql('eligibility_table', conn, if_exists='replace', index=False)
        
        conn.close()
        print("Database initialized successfully!")
        
    except Exception as e:
        print(f"Error initializing database: {e}")

def get_db_schema():
    """Get database schema for Gemini context"""
    try:
        conn = sqlite3.connect(DATABASE_PATH)
        cursor = conn.cursor()
        
        schema_info = ""
        tables = ['ad_sales_table', 'total_sales_table', 'eligibility_table']
        
        for table in tables:
            cursor.execute(f"PRAGMA table_info({table})")
            columns = cursor.fetchall()
            schema_info += f"\n{table}:\n"
            for col in columns:
                schema_info += f"  - {col[1]} ({col[2]})\n"
        
        conn.close()
        return schema_info
        
    except Exception as e:
        return f"Error getting schema: {e}"

def execute_sql_query(sql_query: str):
    """Execute SQL query and return results"""
    try:
        conn = sqlite3.connect(DATABASE_PATH)
        df = pd.read_sql_query(sql_query, conn)
        conn.close()
        return df
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"SQL execution error: {e}")

def generate_chart(df: pd.DataFrame) -> str:
    """Generate chart if dataframe has exactly 2 columns"""
    if df.shape[1] != 2:
        return None
    
    try:
        col1, col2 = df.columns
        
        # Determine chart type based on data types
        if pd.api.types.is_numeric_dtype(df[col2]):
            if pd.api.types.is_datetime64_any_dtype(df[col1]) or 'date' in col1.lower():
                # Line chart for time series
                fig = px.line(df, x=col1, y=col2, title=f"{col2} over {col1}")
            else:
                # Bar chart for categorical data
                fig = px.bar(df, x=col1, y=col2, title=f"{col2} by {col1}")
        else:
            # Default bar chart
            fig = px.bar(df, x=col1, y=col2, title=f"{col2} by {col1}")
        
        # Convert to base64
        buffer = BytesIO()
        fig.write_image(buffer, format='png', width=800, height=400)
        buffer.seek(0)
        chart_base64 = base64.b64encode(buffer.getvalue()).decode()
        
        return f"data:image/png;base64,{chart_base64}"
        
    except Exception as e:
        print(f"Chart generation error: {e}")
        return None

# Initialize database on startup
init_database()

# Create the main app
app = FastAPI(title="AI SQL Agent", description="Natural Language to SQL with Gemini AI")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Pydantic models
class QuestionRequest(BaseModel):
    question: str

class ChartResponse(BaseModel):
    answer: str
    sql_query: str
    table_data: List[dict]
    chart_base64: Optional[str] = None

# Routes
@api_router.get("/")
async def root():
    return {"message": "AI SQL Agent API is running"}

@api_router.get("/schema")
async def get_schema():
    """Get database schema information"""
    schema = get_db_schema()
    return {"schema": schema}

@api_router.post("/ask-question")
async def ask_question_stream(request: QuestionRequest):
    """Convert natural language to SQL and stream human-readable response"""
    
    async def generate_stream():
        try:
            # Get database schema
            schema = get_db_schema()
            
            # Create prompt for Gemini
            prompt = f"""You are a data analyst assistant. Convert the following natural language question into a valid SQL query for SQLite database.

Database Schema:
{schema}

Rules:
1. Use only the table names: ad_sales_table, total_sales_table, eligibility_table
2. Return ONLY the SQL query without any explanation
3. Use proper SQLite syntax
4. Join tables using product_id when needed

Question: {request.question}

SQL Query:"""

            # Get SQL from Gemini
            model = genai.GenerativeModel('gemini-1.5-flash')
            response = model.generate_content(prompt)
            
            sql_query = response.text.strip()
            
            # Clean SQL query (remove markdown formatting if present)
            if sql_query.startswith('```sql'):
                sql_query = sql_query.replace('```sql', '').replace('```', '').strip()
            
            # Execute SQL
            df = execute_sql_query(sql_query)
            
            # Generate human-readable answer
            answer_prompt = f"""Based on the SQL query results, provide a clear, human-readable answer to the original question.

Original Question: {request.question}
SQL Query: {sql_query}
Results: {df.to_string(index=False)}

Provide a concise, informative answer:"""

            answer_response = model.generate_content(answer_prompt)
            answer = answer_response.text.strip()
            
            # Stream the answer word by word
            words = answer.split()
            for i, word in enumerate(words):
                chunk_data = {
                    "type": "token",
                    "content": word + " ",
                    "is_complete": i == len(words) - 1
                }
                yield f"data: {json.dumps(chunk_data)}\n\n"
                await asyncio.sleep(0.05)
            
            # Send final data
            final_data = {
                "type": "complete",
                "sql_query": sql_query,
                "table_data": df.to_dict('records')
            }
            yield f"data: {json.dumps(final_data)}\n\n"
            
        except Exception as e:
            error_data = {
                "type": "error",
                "content": f"Error: {str(e)}"
            }
            yield f"data: {json.dumps(error_data)}\n\n"
    
    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )

@api_router.post("/ask-with-chart", response_model=ChartResponse)
async def ask_with_chart(request: QuestionRequest):
    """Convert natural language to SQL and return result with chart if applicable"""
    
    try:
        # Get database schema
        schema = get_db_schema()
        
        # Create prompt for Gemini
        prompt = f"""You are a data analyst assistant. Convert the following natural language question into a valid SQL query for SQLite database.

Database Schema:
{schema}

Rules:
1. Use only the table names: ad_sales_table, total_sales_table, eligibility_table
2. Return ONLY the SQL query without any explanation
3. Use proper SQLite syntax
4. Join tables using product_id when needed

Question: {request.question}

SQL Query:"""

        # Get SQL from Gemini
        model = genai.GenerativeModel('gemini-1.5-flash')
        response = model.generate_content(prompt)
        
        sql_query = response.text.strip()
        
        # Clean SQL query
        if sql_query.startswith('```sql'):
            sql_query = sql_query.replace('```sql', '').replace('```', '').strip()
        
        # Execute SQL
        df = execute_sql_query(sql_query)
        
        # Generate human-readable answer
        answer_prompt = f"""Based on the SQL query results, provide a clear, human-readable answer to the original question.

Original Question: {request.question}
SQL Query: {sql_query}
Results: {df.to_string(index=False)}

Provide a concise, informative answer:"""

        answer_response = model.generate_content(answer_prompt)
        answer = answer_response.text.strip()
        
        # Generate chart if applicable
        chart_base64 = generate_chart(df)
        
        return ChartResponse(
            answer=answer,
            sql_query=sql_query,
            table_data=df.to_dict('records'),
            chart_base64=chart_base64
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
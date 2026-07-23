import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import openai

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    model: str = "llama-3.3-70b-versatile"
    messages: list

async def generate_groq_stream(messages: list, model: str):
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        yield "data: ⚠️ Error: GROQ_API_KEY is not set on the server.\n\n"
        return

    client = openai.AsyncOpenAI(
        api_key=api_key,
        base_url="https://api.groq.com/openai/v1"
    )

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.5,
            max_tokens=1024,
            stream=True
        )

        async for chunk in response:
            content = chunk.choices[0].delta.content
            if content:
                formatted_chunk = content.replace("\n", "\\n")
                yield f"data: {formatted_chunk}\n\n"

    except Exception as e:
        yield f"data: ⚠️ Error connecting to AI: {str(e)}\n\n"

# API Route
@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    return StreamingResponse(
        generate_groq_stream(request.messages, request.model),
        media_type="text/event-stream"
    )

# Page Routes
@app.get("/")
async def read_root():
    return FileResponse("index.html")

@app.get("/ai")
@app.get("/ai.html")
async def read_ai():
    return FileResponse("ai.html")

# Serve explicit asset files like logo.svg
@app.get("/logo.svg")
async def read_logo():
    return FileResponse("logo.svg")

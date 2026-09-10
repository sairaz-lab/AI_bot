import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
import openai

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    model: str = "gpt-4o-mini"  # Default OpenAI model
    messages: list

async def generate_openai_stream(messages: list, model: str):
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        yield "data: ⚠️ Error: OPENAI_API_KEY is not set on the server.\n\n"
        return

    # Native OpenAI Client
    client = openai.AsyncOpenAI(api_key=api_key)

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

@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    return StreamingResponse(
        generate_openai_stream(request.messages, request.model),
        media_type="text/event-stream"
    )

@app.get("/")
@app.get("/index.html")
async def read_root():
    return FileResponse("index.html")

@app.get("/ai")
@app.get("/ai.html")
async def read_ai():
    return FileResponse("ai.html")

@app.get("/{file_name}")
async def read_static_file(file_name: str):
    file_path = os.path.join(".", file_name)
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return FileResponse(file_path)
    return FileResponse("index.html")

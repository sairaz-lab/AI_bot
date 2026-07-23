import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
import openai

app = FastAPI()

# Enable CORS so frontend and backend communicate without restrictions
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

    # Initialize OpenAI client configured for Groq
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
                # Format chunk as a Server-Sent Event (SSE)
                formatted_chunk = content.replace("\n", "\\n")
                yield f"data: {formatted_chunk}\n\n"

    except Exception as e:
        yield f"data: ⚠️ Error connecting to AI: {str(e)}\n\n"

# ── API ENDPOINT FOR CHATBOT ──
@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    return StreamingResponse(
        generate_groq_stream(request.messages, request.model),
        media_type="text/event-stream"
    )

# ── PAGE ROUTES ──
@app.get("/")
@app.get("/index.html")
async def read_root():
    return FileResponse("index.html")

@app.get("/ai")
@app.get("/ai.html")
async def read_ai():
    return FileResponse("ai.html")

# ── DYNAMIC STATIC ASSETS ROUTE ──
# Serves logo.svg, CSS, JavaScript, or any other project files
@app.get("/{file_name}")
async def read_static_file(file_name: str):
    file_path = os.path.join(".", file_name)
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return FileResponse(file_path)
    return FileResponse("index.html")

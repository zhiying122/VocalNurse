"""
VoiceNursy 完整後端 API
- 註冊/登入（真實帳號）
- STT 語音轉文字（真實 Whisper）
- SOAP 生成（真實 LLM）
- 完整流程：音檔上傳 → STT → SOAP → 回傳
"""
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from schemas import STTInput, BrainOutput
from brain import process
from auth import register, login, verify_token
from stt_service import transcribe_audio
from correction_dict import preprocess

app = FastAPI(title="VoiceNursy API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 註冊/登入 ──

class RegisterRequest(BaseModel):
    employee_id: str
    password: str
    name: str
    role: str = "nurse"

class LoginRequest(BaseModel):
    employee_id: str
    password: str


@app.post("/auth/register")
def api_register(req: RegisterRequest):
    result = register(req.employee_id, req.password, req.name, req.role)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@app.post("/auth/login")
def api_login(req: LoginRequest):
    result = login(req.employee_id, req.password)
    if not result["success"]:
        raise HTTPException(status_code=401, detail=result["message"])
    return result


# ── STT 語音轉文字 ──

@app.post("/stt/transcribe")
async def api_stt(audio: UploadFile = File(...)):
    """
    接收音檔，回傳轉錄文字
    """
    audio_bytes = await audio.read()
    if len(audio_bytes) < 100:
        raise HTTPException(status_code=400, detail="音檔太小或為空")

    try:
        result = transcribe_audio(audio_bytes, audio.filename or "audio.wav")
        # 文字清理
        result["cleaned_text"] = preprocess(result["text"])
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"STT 失敗：{str(e)}")


# ── SOAP 生成 ──

@app.post("/brain/process", response_model=BrainOutput)
def api_brain(input_data: STTInput):
    try:
        return process(input_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── 完整流程：音檔 → STT → SOAP ──

@app.post("/pipeline/full")
async def api_full_pipeline(audio: UploadFile = File(...)):
    """
    一站式：上傳音檔 → STT 轉文字 → LLM 生成 SOAP → 回傳完整結果
    """
    # Step 1: STT
    audio_bytes = await audio.read()
    if len(audio_bytes) < 100:
        raise HTTPException(status_code=400, detail="音檔太小或為空")

    stt_result = transcribe_audio(audio_bytes, audio.filename or "audio.wav")
    cleaned = preprocess(stt_result["text"])

    # Step 2: SOAP
    try:
        brain_output = process(STTInput(raw_text=cleaned))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SOAP 生成失敗：{str(e)}")

    return {
        "stt": {
            "raw_text": stt_result["text"],
            "cleaned_text": cleaned,
            "language": stt_result["language"],
            "confidence": stt_result["confidence"],
        },
        "brain": brain_output.model_dump(),
    }


@app.get("/health")
def health():
    return {"status": "ok", "stt": "ready", "llm": "ready"}

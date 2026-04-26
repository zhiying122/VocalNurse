"""
VoiceNursy 完整後端 API
"""
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from schemas import STTInput, BrainOutput
from brain import process
from auth import register, login
from stt_service import transcribe_audio
from correction_dict import preprocess
from patients import list_patients, add_patient, delete_patient

app = FastAPI(title="VoiceNursy API", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 認證 ──

class RegisterReq(BaseModel):
    employee_id: str
    password: str
    name: str
    role: str = "nurse"

class LoginReq(BaseModel):
    employee_id: str
    password: str

@app.post("/auth/register")
def api_register(req: RegisterReq):
    r = register(req.employee_id, req.password, req.name, req.role)
    if not r["success"]:
        raise HTTPException(400, r["message"])
    return r

@app.post("/auth/login")
def api_login(req: LoginReq):
    r = login(req.employee_id, req.password)
    if not r["success"]:
        raise HTTPException(401, r["message"])
    return r

# ── 病患管理 ──

class PatientReq(BaseModel):
    name: str
    bed: str
    dx: str
    age: int
    allergies: list[str] = []

@app.get("/patients")
def api_list_patients():
    return list_patients()

@app.post("/patients")
def api_add_patient(req: PatientReq):
    return add_patient(req.name, req.bed, req.dx, req.age, req.allergies)

@app.delete("/patients/{patient_id}")
def api_delete_patient(patient_id: str):
    if not delete_patient(patient_id):
        raise HTTPException(404, "病患不存在")
    return {"success": True}

# ── STT ──

@app.post("/stt/transcribe")
async def api_stt(audio: UploadFile = File(...)):
    audio_bytes = await audio.read()
    if len(audio_bytes) < 100:
        raise HTTPException(400, "音檔太小")
    try:
        result = transcribe_audio(audio_bytes, audio.filename or "audio.webm")
        result["cleaned_text"] = preprocess(result["text"])
        return result
    except Exception as e:
        raise HTTPException(500, f"STT 失敗：{e}")

# ── SOAP ──

@app.post("/brain/process", response_model=BrainOutput)
def api_brain(input_data: STTInput):
    try:
        return process(input_data)
    except Exception as e:
        raise HTTPException(500, str(e))

# ── 一站式：音檔 → STT → SOAP ──

@app.post("/pipeline/full")
async def api_full(audio: UploadFile = File(...)):
    audio_bytes = await audio.read()
    if len(audio_bytes) < 100:
        raise HTTPException(400, "音檔太小")

    stt_result = transcribe_audio(audio_bytes, audio.filename or "audio.webm")
    cleaned = preprocess(stt_result["text"])

    try:
        brain_output = process(STTInput(raw_text=cleaned))
    except Exception as e:
        raise HTTPException(500, f"SOAP 生成失敗：{e}")

    return {
        "stt": {
            "raw_text": stt_result["text"],
            "cleaned_text": cleaned,
            "confidence": stt_result["confidence"],
        },
        "brain": brain_output.model_dump(),
    }

@app.get("/health")
def health():
    return {"status": "ok"}

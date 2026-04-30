"""
VoiceNursy 完整後端 API

本檔案定義所有 FastAPI 路由端點，包含：
- /auth/*        — 護理師註冊與登入（JWT 認證）
- /patients/*    — 病患 CRUD 管理
- /stt/*         — 語音轉文字（Speech-to-Text）
- /brain/*       — SOAP 護理紀錄生成（LLM）
- /pipeline/*    — 一站式處理（音檔 → STT → SOAP）
- /records/*     — 【新增】共享護理紀錄的儲存與查詢（需 JWT 驗證）
- /health        — 健康檢查

跨域設定：
    允許所有來源（allow_origins=["*"]），因為前端和後端在不同 port 運行
"""
from fastapi import FastAPI, HTTPException, UploadFile, File, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from schemas import STTInput, BrainOutput, RecordCreate, RecordResponse
from brain import process
from auth import register, login, verify_token
from stt_service import transcribe_audio
from correction_dict import preprocess
from patients import list_patients, add_patient, delete_patient
import records  # 【新增】護理紀錄模組

app = FastAPI(title="VoiceNursy API", version="0.3.0")

# 跨域中介軟體：允許前端（localhost:3000）存取後端（localhost:8001）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],    # 開發環境允許所有來源，正式環境應限制
    allow_methods=["*"],    # 允許所有 HTTP 方法（GET, POST, DELETE 等）
    allow_headers=["*"],    # 允許所有 Header（包含 Authorization）
)


# ══════════════════════════════════════════════════════════
# JWT 驗證 Dependency（FastAPI 依賴注入）
# ══════════════════════════════════════════════════════════

async def get_current_user(authorization: str = Header(...)) -> dict:
    """
    從 HTTP Authorization header 提取並驗證 JWT token。

    這是一個 FastAPI Dependency，只有紀錄相關的 API 端點會使用它。
    其他端點（/patients、/brain/process 等）不需要驗證，維持原有行為。

    Header 格式：Authorization: Bearer <jwt_token>

    驗證流程：
        1. 檢查 header 是否以 "Bearer " 開頭
        2. 提取 token 字串
        3. 呼叫 auth.verify_token() 驗證 token 有效性與過期時間
        4. 從 token payload 提取使用者資訊

    回傳值：
        dict — 包含 employee_id（員工編號）、name（姓名）、role（角色）

    例外：
        HTTPException(401) — token 缺失、格式錯誤、過期或無效時拋出
    """
    # 檢查 Authorization header 格式
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未授權：請重新登入")

    # 提取 token（去掉 "Bearer " 前綴）
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="未授權：請重新登入")

    # 驗證 token（檢查簽名、過期時間等）
    payload = verify_token(token)
    if payload is None:
        raise HTTPException(status_code=401, detail="未授權：請重新登入")

    # 從 JWT payload 提取使用者資訊
    # sub = subject，即員工編號（登入時寫入的）
    return {
        "employee_id": payload.get("sub"),
        "name": payload.get("name"),
        "role": payload.get("role"),
    }


# ══════════════════════════════════════════════════════════
# 認證 API（註冊 / 登入）
# ══════════════════════════════════════════════════════════

class RegisterReq(BaseModel):
    """註冊請求的資料格式"""
    employee_id: str    # 員工編號（唯一識別碼）
    password: str       # 密碼（會經過 PBKDF2 雜湊後儲存）
    name: str           # 護理師姓名
    role: str = "nurse" # 角色，預設為護理師

class LoginReq(BaseModel):
    """登入請求的資料格式"""
    employee_id: str    # 員工編號
    password: str       # 密碼

@app.post("/auth/register")
def api_register(req: RegisterReq):
    """護理師註冊：建立新帳號"""
    r = register(req.employee_id, req.password, req.name, req.role)
    if not r["success"]:
        raise HTTPException(400, r["message"])
    return r

@app.post("/auth/login")
def api_login(req: LoginReq):
    """護理師登入：驗證帳密，回傳 JWT token"""
    r = login(req.employee_id, req.password)
    if not r["success"]:
        raise HTTPException(401, r["message"])
    return r


# ══════════════════════════════════════════════════════════
# 病患管理 API
# ══════════════════════════════════════════════════════════

class PatientReq(BaseModel):
    """新增病患的請求格式"""
    name: str               # 病患姓名
    bed: str                # 床號（例如 "4A-03"）
    dx: str                 # 診斷（Diagnosis）
    age: int                # 年齡
    allergies: list[str] = []  # 過敏原列表

@app.get("/patients")
def api_list_patients():
    """取得所有病患列表"""
    return list_patients()

@app.post("/patients")
def api_add_patient(req: PatientReq):
    """新增一位病患"""
    return add_patient(req.name, req.bed, req.dx, req.age, req.allergies)

@app.delete("/patients/{patient_id}")
def api_delete_patient(patient_id: str):
    """刪除指定病患"""
    if not delete_patient(patient_id):
        raise HTTPException(404, "病患不存在")
    return {"success": True}


# ══════════════════════════════════════════════════════════
# STT 語音轉文字 API
# ══════════════════════════════════════════════════════════

@app.post("/stt/transcribe")
async def api_stt(audio: UploadFile = File(...)):
    """
    接收音檔，進行語音辨識（STT），回傳辨識文字。
    同時會經過 correction_dict 進行藥名標準化前處理。
    """
    audio_bytes = await audio.read()
    if len(audio_bytes) < 100:
        raise HTTPException(400, "音檔太小")
    try:
        result = transcribe_audio(audio_bytes, audio.filename or "audio.webm")
        result["cleaned_text"] = preprocess(result["text"])  # 藥名標準化
        return result
    except Exception as e:
        raise HTTPException(500, f"STT 失敗：{e}")


# ══════════════════════════════════════════════════════════
# SOAP 護理紀錄生成 API
# ══════════════════════════════════════════════════════════

@app.post("/brain/process", response_model=BrainOutput)
def api_brain(input_data: STTInput):
    """
    接收文字輸入，透過 LLM 生成結構化 SOAP 護理紀錄。
    處理流程：PII 遮罩 → 前處理 → LLM 生成 → 驗證輸出
    """
    try:
        return process(input_data)
    except Exception as e:
        raise HTTPException(500, str(e))


# ══════════════════════════════════════════════════════════
# 一站式處理 API（音檔 → STT → SOAP）
# ══════════════════════════════════════════════════════════

@app.post("/pipeline/full")
async def api_full(audio: UploadFile = File(...)):
    """
    一站式處理：接收音檔，自動完成 STT + SOAP 生成。
    前端開啟「自動模式」時會呼叫此端點，省去手動按「生成 SOAP」的步驟。
    """
    audio_bytes = await audio.read()
    if len(audio_bytes) < 100:
        raise HTTPException(400, "音檔太小")

    # 步驟 1：語音辨識
    stt_result = transcribe_audio(audio_bytes, audio.filename or "audio.webm")
    cleaned = preprocess(stt_result["text"])

    # 步驟 2：SOAP 生成
    try:
        brain_output = process(STTInput(raw_text=cleaned))
    except Exception as e:
        raise HTTPException(500, f"SOAP 生成失敗：{e}")

    return {
        "stt": {
            "raw_text": stt_result["text"],       # 原始辨識文字
            "cleaned_text": cleaned,               # 前處理後的文字
            "confidence": stt_result["confidence"],# 辨識信心度
        },
        "brain": brain_output.model_dump(),        # 結構化 SOAP 輸出
    }


# ══════════════════════════════════════════════════════════
# 【新增】共享護理紀錄 API（需 JWT 驗證）
#
# 這三個端點是「共享護理紀錄」功能的核心 API：
# - POST /records              — 儲存一筆 SOAP 紀錄
# - GET  /records/patient/{id} — 查詢特定病患的所有紀錄
# - GET  /records              — 查詢所有紀錄（交班報告用）
#
# 所有端點都需要 JWT 驗證（透過 get_current_user dependency）
# 護理師的身份資訊會自動從 JWT token 中提取，不需要前端額外傳送
# ══════════════════════════════════════════════════════════

@app.post("/records", response_model=RecordResponse)
def api_add_record(req: RecordCreate, user: dict = Depends(get_current_user)):
    """
    儲存一筆 SOAP 護理紀錄到後端。

    前端 confirmSave() 會呼叫此端點。
    護理師的 employee_id 和 name 會自動從 JWT token 中提取，
    確保紀錄的建立者資訊正確且無法偽造。

    參數：
        req  — RecordCreate 格式的請求 body（包含 SOAP、藥物、班別等）
        user — 從 JWT 自動提取的使用者資訊（FastAPI dependency injection）

    回傳：
        RecordResponse — 完整的紀錄（含系統產生的 ID 和時間戳記）
    """
    try:
        saved = records.add_record(
            patient_id=req.patient_id,
            soap=req.soap.model_dump(),                              # Pydantic → dict
            medications=[m.model_dump() for m in req.medications],   # 藥物列表轉 dict
            pain_scale=req.pain_scale,
            warnings=req.warnings,
            raw_text=req.raw_text,
            nurse_id=user["employee_id"],   # 從 JWT 取得，不是前端傳的
            nurse_name=user["name"],        # 從 JWT 取得，不是前端傳的
            shift=req.shift,
        )
        return saved
    except ValueError:
        raise HTTPException(404, "病患不存在")

@app.get("/records/patient/{patient_id}", response_model=list[RecordResponse])
def api_get_patient_records(patient_id: str, user: dict = Depends(get_current_user)):
    """
    查詢特定病患的所有 SOAP 紀錄（包含所有護理師建立的）。

    前端 selectPatient() 會呼叫此端點，載入病患的完整護理歷程。
    回傳結果按建立時間降序排列（最新的在前面）。

    這是「共享護理紀錄」的關鍵：不同護理師登入後，
    都能看到其他護理師對同一病患建立的紀錄。
    """
    try:
        return records.get_patient_records(patient_id)
    except ValueError:
        raise HTTPException(404, "病患不存在")

@app.get("/records", response_model=list[RecordResponse])
def api_list_records(date: Optional[str] = None, user: dict = Depends(get_current_user)):
    """
    查詢所有紀錄（支援日期篩選）。

    前端交班報告頁面（renderHandover）會呼叫此端點，
    一次取得所有病患的紀錄摘要，供班別交接使用。

    參數：
        date — 可選的日期篩選，格式 YYYY-MM-DD（例如 ?date=2025-01-15）
               若不提供則回傳所有紀錄
    """
    return records.list_records(date_filter=date)


# ══════════════════════════════════════════════════════════
# 健康檢查
# ══════════════════════════════════════════════════════════

@app.get("/health")
def health():
    """健康檢查端點，用於確認後端服務是否正常運行"""
    return {"status": "ok"}

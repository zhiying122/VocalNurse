"""
VoiceNursy 完整後端 API

本檔案定義所有 FastAPI 路由端點，包含：
- /auth/*        — 護理師註冊與登入（JWT 認證）+ 登入速率限制
- /patients/*    — 病患 CRUD 管理
- /stt/*         — 語音轉文字（Speech-to-Text）
- /brain/*       — SOAP 護理紀錄生成（LLM）
- /pipeline/*    — 一站式處理（音檔 → STT → SOAP）
- /records/*     — 共享護理紀錄的儲存、查詢、編輯（需 JWT 驗證）
- /health        — 健康檢查

安全措施：
- CORS 來源從環境變數 CORS_ORIGINS 讀取
- 登入端點有速率限制（5 次失敗 / 15 分鐘）
- 輸入驗證（密碼長度、欄位必填等）
"""
import os
import time
import logging
from collections import defaultdict
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException, UploadFile, File, Depends, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from typing import Optional
from schemas import STTInput, BrainOutput, RecordCreate, RecordResponse, RecordUpdate
from brain import process
from auth import register, login, verify_token
from stt_service import transcribe_audio
from correction_dict import preprocess
from patients import list_patients, add_patient, delete_patient, update_patient
from dotenv import load_dotenv
import records  # 護理紀錄模組

# 載入 .env 環境變數
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

# 設定日誌
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voicenursy")

app = FastAPI(title="VoiceNursy API", version="0.4.0")


# ══════════════════════════════════════════════════════════
# CORS 設定：從環境變數讀取允許的來源
# ══════════════════════════════════════════════════════════

# 從環境變數 CORS_ORIGINS 讀取允許的來源（逗號分隔）
# 預設值為開發環境常用的 localhost 位址
_cors_env = os.getenv("CORS_ORIGINS", "")
if _cors_env.strip():
    ALLOWED_ORIGINS = [origin.strip() for origin in _cors_env.split(",") if origin.strip()]
else:
    # 開發環境預設值
    ALLOWED_ORIGINS = [
        "http://localhost:3000",
        "http://localhost:8080",
        "http://127.0.0.1:3000",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],    # 允許所有 HTTP 方法（GET, POST, PUT, DELETE 等）
    allow_headers=["*"],    # 允許所有 Header（包含 Authorization）
)


# ══════════════════════════════════════════════════════════
# 登入速率限制器（記憶體內）
#
# 防止暴力破解攻擊：
# - 每個員工編號在 15 分鐘內最多允許 5 次失敗登入
# - 超過限制後回傳 HTTP 429
# - 成功登入後重置計數器
# ══════════════════════════════════════════════════════════

# 速率限制常數
RATE_LIMIT_MAX_ATTEMPTS = 5       # 最大失敗次數
RATE_LIMIT_WINDOW_SECONDS = 900   # 時間窗口：15 分鐘（900 秒）

# 儲存每個員工編號的失敗登入紀錄
# 格式：{ employee_id: [timestamp1, timestamp2, ...] }
_login_attempts: dict[str, list[float]] = defaultdict(list)


def _check_rate_limit(employee_id: str) -> bool:
    """
    檢查指定員工編號是否超過登入速率限制。

    回傳：
        True  — 已超過限制，應拒絕登入
        False — 未超過限制，可以繼續登入
    """
    now = time.time()
    cutoff = now - RATE_LIMIT_WINDOW_SECONDS

    # 清除過期的失敗紀錄（超過 15 分鐘的）
    _login_attempts[employee_id] = [
        t for t in _login_attempts[employee_id] if t > cutoff
    ]

    # 檢查是否超過限制
    return len(_login_attempts[employee_id]) >= RATE_LIMIT_MAX_ATTEMPTS


def _record_failed_attempt(employee_id: str):
    """記錄一次失敗的登入嘗試"""
    _login_attempts[employee_id].append(time.time())
    logger.warning(
        "登入失敗：employee_id=%s，目前失敗次數=%d",
        employee_id,
        len(_login_attempts[employee_id]),
    )


def _reset_rate_limit(employee_id: str):
    """登入成功後重置速率限制計數器"""
    if employee_id in _login_attempts:
        del _login_attempts[employee_id]


# ══════════════════════════════════════════════════════════
# JWT 驗證 Dependency（FastAPI 依賴注入）
# ══════════════════════════════════════════════════════════

async def get_current_user(authorization: str = Header(...)) -> dict:
    """
    從 HTTP Authorization header 提取並驗證 JWT token。

    Header 格式：Authorization: Bearer <jwt_token>

    回傳值：
        dict — 包含 employee_id（員工編號）、name（姓名）、role（角色）

    例外：
        HTTPException(401) — token 缺失、格式錯誤、過期或無效時拋出
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未授權：請重新登入")

    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="未授權：請重新登入")

    payload = verify_token(token)
    if payload is None:
        raise HTTPException(status_code=401, detail="未授權：請重新登入")

    return {
        "employee_id": payload.get("sub"),
        "name": payload.get("name"),
        "role": payload.get("role"),
    }


# ══════════════════════════════════════════════════════════
# 認證 API（註冊 / 登入）
# ══════════════════════════════════════════════════════════

class RegisterReq(BaseModel):
    """註冊請求的資料格式（含輸入驗證）"""
    employee_id: str    # 員工編號（唯一識別碼）
    password: str       # 密碼（會經過 PBKDF2 雜湊後儲存）
    name: str           # 護理師姓名
    role: str = "nurse" # 角色，預設為護理師

    # 輸入驗證：密碼至少 4 字元，員工編號和姓名不可為空
    @field_validator("password")
    @classmethod
    def password_min_length(cls, v):
        if len(v.strip()) < 4:
            raise ValueError("密碼至少需要 4 個字元")
        return v

    @field_validator("employee_id")
    @classmethod
    def employee_id_not_empty(cls, v):
        if len(v.strip()) < 1:
            raise ValueError("員工編號不可為空")
        return v

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v):
        if len(v.strip()) < 1:
            raise ValueError("姓名不可為空")
        return v

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
    """
    護理師登入：驗證帳密，回傳 JWT token。
    包含速率限制：5 次失敗 / 15 分鐘。
    """
    # 檢查速率限制
    if _check_rate_limit(req.employee_id):
        logger.warning("登入被速率限制阻擋：employee_id=%s", req.employee_id)
        raise HTTPException(
            status_code=429,
            detail="登入嘗試次數過多，請 15 分鐘後再試",
        )

    r = login(req.employee_id, req.password)

    if not r["success"]:
        # 登入失敗：記錄失敗嘗試
        _record_failed_attempt(req.employee_id)
        raise HTTPException(401, r["message"])

    # 登入成功：重置速率限制
    _reset_rate_limit(req.employee_id)
    return r


@app.post("/auth/refresh")
def api_refresh_token(user: dict = Depends(get_current_user)):
    """
    刷新 JWT token。
    在 token 快過期時呼叫，回傳新的 token（有效期重置為 8 小時）。
    需要攜帶目前有效的 token 才能刷新。
    """
    from auth import _load_users, SECRET_KEY, ALGORITHM, TOKEN_EXPIRE_HOURS
    from datetime import timedelta
    from jose import jwt as jose_jwt

    users = _load_users()
    user_data = users.get(user["employee_id"])
    if not user_data:
        raise HTTPException(404, "使用者不存在")

    new_token = jose_jwt.encode(
        {
            "sub": user["employee_id"],
            "name": user_data["name"],
            "role": user_data["role"],
            "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS),
        },
        SECRET_KEY,
        algorithm=ALGORITHM,
    )
    return {
        "token": new_token,
        "user": {"employee_id": user["employee_id"], "name": user_data["name"], "role": user_data["role"]},
    }


@app.get("/auth/login-attempts/{employee_id}")
def api_login_attempts(employee_id: str, user: dict = Depends(get_current_user)):
    """
    查詢指定員工編號的近期失敗登入次數（管理員用途）。
    需要 JWT 驗證才能存取。

    回傳：
        recent_failed_attempts — 15 分鐘內的失敗登入次數
        is_locked — 是否已被速率限制鎖定
    """
    now = time.time()
    cutoff = now - RATE_LIMIT_WINDOW_SECONDS
    recent = [t for t in _login_attempts.get(employee_id, []) if t > cutoff]
    return {
        "employee_id": employee_id,
        "recent_failed_attempts": len(recent),
        "is_locked": len(recent) >= RATE_LIMIT_MAX_ATTEMPTS,
        "window_minutes": RATE_LIMIT_WINDOW_SECONDS // 60,
    }


# ══════════════════════════════════════════════════════════
# 病患管理 API
# ══════════════════════════════════════════════════════════

class PatientReq(BaseModel):
    """新增病患的請求格式（含輸入驗證）"""
    name: str               # 病患姓名
    bed: str                # 床號（例如 "4A-03"）
    dx: str                 # 診斷（Diagnosis）
    age: int                # 年齡
    allergies: list[str] = []  # 過敏原列表

    # 輸入驗證：姓名和床號不可為空，年齡需在合理範圍
    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v):
        if len(v.strip()) < 1:
            raise ValueError("病患姓名不可為空")
        return v

    @field_validator("bed")
    @classmethod
    def bed_not_empty(cls, v):
        if len(v.strip()) < 1:
            raise ValueError("床號不可為空")
        return v

    @field_validator("age")
    @classmethod
    def age_range(cls, v):
        if v < 0 or v > 150:
            raise ValueError("年齡必須在 0 到 150 之間")
        return v

class PatientUpdateReq(BaseModel):
    """更新病患資料的請求格式（所有欄位可選）"""
    name: Optional[str] = None
    bed: Optional[str] = None
    dx: Optional[str] = None
    age: Optional[int] = None
    allergies: Optional[list[str]] = None

    @field_validator("age")
    @classmethod
    def age_range(cls, v):
        if v is not None and (v < 0 or v > 150):
            raise ValueError("年齡必須在 0 到 150 之間")
        return v

@app.get("/patients")
def api_list_patients(user: dict = Depends(get_current_user)):
    """取得所有病患列表（需要登入）"""
    return list_patients()

@app.post("/patients")
def api_add_patient(req: PatientReq, user: dict = Depends(get_current_user)):
    """新增一位病患（需要登入）"""
    return add_patient(req.name, req.bed, req.dx, req.age, req.allergies)

@app.delete("/patients/{patient_id}")
def api_delete_patient(patient_id: str, user: dict = Depends(get_current_user)):
    """刪除指定病患（需要登入）"""
    if not delete_patient(patient_id):
        raise HTTPException(404, "病患不存在")
    return {"success": True}


@app.put("/patients/{patient_id}")
def api_update_patient(patient_id: str, req: PatientUpdateReq, user: dict = Depends(get_current_user)):
    """更新病患資料（床號、診斷、過敏原等）"""
    updates = req.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "未提供任何更新欄位")
    result = update_patient(patient_id, updates)
    if result is None:
        raise HTTPException(404, "病患不存在")
    return result


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
# 共享護理紀錄 API（需 JWT 驗證）
# ══════════════════════════════════════════════════════════

@app.post("/records", response_model=RecordResponse)
def api_add_record(req: RecordCreate, user: dict = Depends(get_current_user)):
    """
    儲存一筆 SOAP 護理紀錄到後端。

    前端 confirmSave() 會呼叫此端點。
    護理師的 employee_id 和 name 會自動從 JWT token 中提取。
    """
    try:
        saved = records.add_record(
            patient_id=req.patient_id,
            soap=req.soap.model_dump(),
            medications=[m.model_dump() for m in req.medications],
            pain_scale=req.pain_scale,
            warnings=req.warnings,
            raw_text=req.raw_text,
            nurse_id=user["employee_id"],
            nurse_name=user["name"],
            shift=req.shift,
            alerts=req.alerts,  # 【新增】安全警示持久化
        )
        return saved
    except ValueError:
        raise HTTPException(404, "病患不存在")

@app.get("/records/patient/{patient_id}", response_model=list[RecordResponse])
def api_get_patient_records(patient_id: str, user: dict = Depends(get_current_user)):
    """
    查詢特定病患的所有 SOAP 紀錄（包含所有護理師建立的）。
    """
    try:
        return records.get_patient_records(patient_id)
    except ValueError:
        raise HTTPException(404, "病患不存在")

@app.get("/records")
def api_list_records(
    date: Optional[str] = None,
    page: int = Query(1, ge=1, description="頁碼，從 1 開始"),
    page_size: int = Query(50, ge=1, le=200, description="每頁筆數，預設 50，最大 200"),
    user: dict = Depends(get_current_user),
):
    """
    查詢所有紀錄（支援日期篩選和分頁）。

    參數：
        date      — 可選的日期篩選，格式 YYYY-MM-DD
        page      — 頁碼，從 1 開始（預設 1）
        page_size — 每頁筆數（預設 50，最大 200）
    """
    return records.list_records(date_filter=date, page=page, page_size=page_size)


@app.put("/records/{record_id}", response_model=RecordResponse)
def api_update_record(
    record_id: str,
    req: RecordUpdate,
    user: dict = Depends(get_current_user),
):
    """
    編輯指定紀錄的部分欄位（JWT 保護）。

    僅允許更新：soap 欄位、medications、pain_scale、warnings。
    只有紀錄的原始建立者才能修改。
    """
    # 先取得紀錄，確認建立者身份
    all_recs = records.list_records()
    target = next((r for r in all_recs.get("records", []) if r["id"] == record_id), None)
    if target is None:
        raise HTTPException(404, "紀錄不存在")
    if target.get("nurse_id") != user["employee_id"]:
        raise HTTPException(403, "無權限修改他人建立的紀錄")

    updates = req.model_dump(exclude_unset=True, mode="python")
    if not updates:
        raise HTTPException(400, "未提供任何更新欄位")

    # 將 Pydantic model 序列化為純 dict，確保 records.update_record 收到的是可 JSON 序列化的資料
    if "soap" in updates and updates["soap"] is not None:
        if hasattr(updates["soap"], "model_dump"):
            updates["soap"] = updates["soap"].model_dump()
    if "medications" in updates and updates["medications"] is not None:
        updates["medications"] = [
            m.model_dump() if hasattr(m, "model_dump") else m
            for m in updates["medications"]
        ]

    result = records.update_record(record_id, updates)
    if result is None:
        raise HTTPException(404, "紀錄不存在")
    return result


@app.delete("/records/{record_id}")
def api_delete_record(record_id: str, user: dict = Depends(get_current_user)):
    """刪除指定紀錄（只有建立者才能刪除）"""
    try:
        success = records.delete_record(record_id, user["employee_id"])
        if not success:
            raise HTTPException(404, "紀錄不存在")
        return {"success": True}
    except PermissionError as e:
        raise HTTPException(403, str(e))


# ══════════════════════════════════════════════════════════
# 健康檢查
# ══════════════════════════════════════════════════════════

@app.get("/health")
def health():
    """健康檢查端點，用於確認後端服務是否正常運行"""
    return {"status": "ok"}

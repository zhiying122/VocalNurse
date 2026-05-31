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
from schemas import (
    ConsentStatus,
    ConsentRecord,
    ConsentStatusResponse,
    ConsentSummary,
    ConsentAuditEntry,
)
from brain import process
from auth import register, login, verify_token
from stt_service import transcribe_audio
from correction_dict import preprocess
from patients import list_patients, add_patient, delete_patient, update_patient
from dotenv import load_dotenv
import records  # 護理紀錄模組
import consent  # 知情同意服務模組
from consent import ConsentRequired, ConsentVersionMismatch

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
    建立前會驗證病患的知情同意狀態。
    """
    # ── 知情同意驗證 ──
    try:
        consent_id = consent.verify_consent_for_record(req.patient_id)
    except ConsentRequired as e:
        raise HTTPException(
            status_code=403,
            detail=f"無法建立護理紀錄：病患尚未完成知情同意（目前狀態：{e.status}）",
        )
    except ConsentVersionMismatch as e:
        # 記錄版本不符的稽核事件
        consent.log_audit_event(
            event_type="validation_failed",
            patient_id=req.patient_id,
            nurse_id=user["employee_id"],
            consent_version=e.patient_version,
            notes=f"版本不符：病患版本 {e.patient_version}，目前版本 {e.current_version}",
        )
        raise HTTPException(
            status_code=403,
            detail=f"無法建立護理紀錄：同意書版本不符（病患版本 {e.patient_version}，目前版本 {e.current_version}），請重新取得同意",
        )

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
            consent_id=consent_id,  # 【新增】知情同意 ID
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

@app.post("/sbar/generate")
def api_sbar_generate(req: dict, user: dict = Depends(get_current_user)):
    """
    AI 生成 SBAR 交班口語稿。

    接收本班所有病患的紀錄摘要，透過 LLM 生成符合台灣醫院習慣的
    SBAR（Situation / Background / Assessment / Recommendation）格式交班稿。

    請求格式：
        {
          "shift": "日班",
          "nurse_name": "王小明",
          "patients": [
            {
              "name": "張三",
              "bed": "3A-01",
              "dx": "右膝關節置換術後",
              "age": 72,
              "records": [
                { "soap": {...}, "medications": [...], "pain_scale": 4, "alerts": [...] }
              ]
            },
            ...
          ]
        }

    回傳格式：
        {
          "sbar_text": "【交班口語稿】...",
          "patients": [
            { "name": "張三", "bed": "3A-01", "sbar": "S: ... B: ... A: ... R: ..." },
            ...
          ]
        }
    """
    from llm_client import call_llm

    shift = req.get("shift", "")
    nurse_name = req.get("nurse_name", "")
    patients_data = req.get("patients", [])

    if not patients_data:
        raise HTTPException(400, "未提供病患資料")

    # 組裝每位病患的摘要文字，送給 LLM
    patient_summaries = []
    for p in patients_data:
        records_list = p.get("records", [])
        if not records_list:
            continue

        # 取最新一筆紀錄
        latest = records_list[-1]
        soap = latest.get("soap", {})
        meds = latest.get("medications", [])
        pain = latest.get("pain_scale")
        alerts = latest.get("alerts", [])

        med_str = "、".join([f"{m.get('name','')} {m.get('dose','')} {m.get('unit','')}" for m in meds]) or "無"
        alert_str = "、".join([a.get("message", "") for a in alerts if a.get("message")]) or "無"
        pain_str = f"{pain}/10" if pain is not None else "未記錄"

        summary = (
            f"病患：{p.get('name','')}，床號：{p.get('bed','')}，年齡：{p.get('age','')}歲，"
            f"診斷：{p.get('dx','')}\n"
            f"主訴（S）：{soap.get('subjective','')}\n"
            f"客觀（O）：{soap.get('objective','')}\n"
            f"評估（A）：{soap.get('assessment','')}\n"
            f"計畫（P）：{soap.get('plan','')}\n"
            f"給藥：{med_str}，疼痛：{pain_str}，安全警示：{alert_str}"
        )
        patient_summaries.append({"name": p.get("name",""), "bed": p.get("bed",""), "summary": summary})

    if not patient_summaries:
        raise HTTPException(400, "所有病患均無紀錄")

    SBAR_SYSTEM_PROMPT = """你是台灣醫院的資深護理長，擅長用 SBAR 格式進行護理交班。
請根據提供的護理紀錄，為每位病患生成一段簡潔的 SBAR 交班口語稿。

SBAR 格式說明：
- S（Situation 現況）：病患目前最重要的狀況，一句話說清楚
- B（Background 背景）：診斷、用藥、相關病史
- A（Assessment 評估）：護理師的判斷，目前最需要關注的問題
- R（Recommendation 建議）：接班護理師需要執行或注意的事項

輸出規定：
1. 只輸出 JSON，不加任何說明文字
2. 語氣要口語化、自然，像護理師在說話，不要太書面
3. 每個欄位 1-3 句話，簡潔有力
4. 有安全警示的病患，R 欄位必須特別提醒
5. 繁體中文

輸出 JSON 格式：
{"patients":[{"name":"病患姓名","bed":"床號","S":"現況一句話","B":"背景資訊","A":"評估重點","R":"接班建議"}]}"""

    summaries_text = "\n\n".join([
        f"【{i+1}】{ps['name']}（{ps['bed']}）\n{ps['summary']}"
        for i, ps in enumerate(patient_summaries)
    ])

    user_prompt = f"請為以下 {len(patient_summaries)} 位病患生成 SBAR 交班口語稿：\n\n{summaries_text}\n\nJSON 輸出："

    try:
        result = call_llm(SBAR_SYSTEM_PROMPT, user_prompt)
    except Exception as e:
        raise HTTPException(500, f"SBAR 生成失敗：{e}")

    # 組裝完整口語稿（供直接朗讀或列印）
    sbar_patients = result.get("patients", [])
    full_text_lines = [
        f"【{shift} 交班口語稿】  護理師：{nurse_name}",
        f"共 {len(sbar_patients)} 位病患\n",
        "─" * 40,
    ]
    for sp in sbar_patients:
        full_text_lines.append(
            f"\n🏥 {sp.get('name','')}（{sp.get('bed','')}）\n"
            f"S：{sp.get('S','')}\n"
            f"B：{sp.get('B','')}\n"
            f"A：{sp.get('A','')}\n"
            f"R：{sp.get('R','')}"
        )
        full_text_lines.append("─" * 40)

    return {
        "sbar_text": "\n".join(full_text_lines),
        "patients": sbar_patients,
        "shift": shift,
        "nurse_name": nurse_name,
    }


@app.get("/stress/team")
def api_team_stress(
    days: int = 7,
    user: dict = Depends(get_current_user),
):
    """
    全體護理師壓力概覽（護理長視角）。
    回傳所有有紀錄的護理師的壓力等級摘要，
    按壓力分數降序排列（最需要關注的在前面）。
    """
    from datetime import timedelta
    from collections import defaultdict

    all_recs = records.list_records(page=1, page_size=2000)
    rec_list = all_recs.get("records", [])

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    recent_recs = [
        r for r in rec_list
        if datetime.fromisoformat(r["created_at"].replace("Z", "+00:00")) >= cutoff
    ]

    nurse_ids = list({r["nurse_id"] for r in recent_recs if r.get("nurse_id")})

    results = []
    for nid in nurse_ids:
        n_recs = [r for r in recent_recs if r.get("nurse_id") == nid]
        nurse_name = n_recs[0].get("nurse_name", nid) if n_recs else nid

        late_night = sum(
            1 for r in n_recs
            if ((datetime.fromisoformat(r["created_at"].replace("Z", "+00:00")).hour + 8) % 24) >= 22
            or ((datetime.fromisoformat(r["created_at"].replace("Z", "+00:00")).hour + 8) % 24) < 6
        )
        daily: dict[str, int] = defaultdict(int)
        for r in n_recs:
            daily[r["created_at"][:10]] += 1
        work_days = len(daily)
        max_daily = max(daily.values()) if daily else 0

        score = min(late_night * 8 + max(work_days - 4, 0) * 5 + max(max_daily - 9, 0) * 5, 100)

        level = "critical" if score >= 70 else "high" if score >= 45 else "medium" if score >= 20 else "low"

        results.append({
            "nurse_id": nid,
            "nurse_name": nurse_name,
            "stress_level": level,
            "stress_score": score,
            "work_days": work_days,
            "late_night_count": late_night,
            "total_records": len(n_recs),
        })

    results.sort(key=lambda x: x["stress_score"], reverse=True)
    return {"nurses": results, "days_analyzed": days}


@app.get("/stress/nurse/{nurse_id}")
def api_nurse_stress(
    nurse_id: str,
    days: int = 7,
    user: dict = Depends(get_current_user),
):
    """
    單一護理師壓力指標分析（行為模式分析）。

    分析過去 N 天的紀錄行為，偵測以下壓力指標：
    1. 深夜補寫（22:00–06:00 建立的紀錄）
    2. 連續高密度工作（單日紀錄數 ≥ 10）
    3. 高警示密度（警示數 / 紀錄數 ≥ 0.4）
    4. 連續多日工作（7 天內工作天數 ≥ 5）
    5. 紀錄品質下降（近期 SOAP 欄位平均字數 < 歷史平均的 60%）
    """
    from datetime import timedelta
    from collections import defaultdict

    all_recs = records.list_records(page=1, page_size=2000)
    rec_list = all_recs.get("records", [])

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    nurse_recs = [
        r for r in rec_list
        if r.get("nurse_id") == nurse_id
        and datetime.fromisoformat(r["created_at"].replace("Z", "+00:00")) >= cutoff
    ]

    nurse_name = nurse_recs[0].get("nurse_name", nurse_id) if nurse_recs else nurse_id

    if not nurse_recs:
        return {
            "nurse_id": nurse_id,
            "nurse_name": nurse_name,
            "stress_level": "low",
            "stress_score": 0,
            "indicators": [],
            "care_message": "目前沒有足夠的紀錄資料進行分析。",
            "days_analyzed": days,
            "total_records": 0,
            "work_days": 0,
        }

    indicators = []
    stress_score = 0

    # ── 指標 1：深夜補寫（22:00–06:00）──
    late_night_recs = []
    for r in nurse_recs:
        try:
            dt = datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))
            local_hour = (dt.hour + 8) % 24
            if local_hour >= 22 or local_hour < 6:
                late_night_recs.append(r)
        except Exception:
            pass

    if late_night_recs:
        count = len(late_night_recs)
        severity = "critical" if count >= 5 else "warning"
        indicators.append({
            "type": "late_night_writing",
            "label": "深夜補寫",
            "description": f"過去 {days} 天有 {count} 筆紀錄在深夜（22:00–06:00）建立",
            "count": count,
            "severity": severity,
        })
        stress_score += min(count * 8, 30)

    # ── 指標 2：單日高密度工作（紀錄數 ≥ 10）──
    daily_counts: dict[str, int] = defaultdict(int)
    for r in nurse_recs:
        day = r["created_at"][:10]
        daily_counts[day] += 1

    high_density_days = [(d, c) for d, c in daily_counts.items() if c >= 10]
    if high_density_days:
        max_count = max(c for _, c in high_density_days)
        severity = "critical" if max_count >= 15 else "warning"
        indicators.append({
            "type": "high_density",
            "label": "高密度工作日",
            "description": f"有 {len(high_density_days)} 天單日紀錄數 ≥ 10（最高 {max_count} 筆）",
            "count": len(high_density_days),
            "severity": severity,
        })
        stress_score += min(len(high_density_days) * 10, 25)

    # ── 指標 3：高警示密度（警示數 / 紀錄數 ≥ 0.4）──
    total_alerts = sum(len(r.get("alerts") or r.get("warnings") or []) for r in nurse_recs)
    alert_ratio = total_alerts / len(nurse_recs) if nurse_recs else 0
    if alert_ratio >= 0.4:
        severity = "critical" if alert_ratio >= 0.7 else "warning"
        indicators.append({
            "type": "high_alert_density",
            "label": "高警示密度",
            "description": f"平均每筆紀錄觸發 {alert_ratio:.1f} 次安全警示，壓力較高",
            "count": total_alerts,
            "severity": severity,
        })
        stress_score += min(int(alert_ratio * 20), 20)

    # ── 指標 4：連續多日工作（工作天數 ≥ 5）──
    work_days = len(daily_counts)
    if work_days >= 5:
        severity = "critical" if work_days >= 7 else "warning"
        indicators.append({
            "type": "consecutive_days",
            "label": "連續多日工作",
            "description": f"過去 {days} 天中有 {work_days} 天有建立紀錄",
            "count": work_days,
            "severity": severity,
        })
        stress_score += min((work_days - 4) * 5, 15)

    # ── 指標 5：紀錄品質下降（近期 SOAP 平均字數 < 歷史平均 60%）──
    def avg_soap_length(recs):
        if not recs:
            return 0
        total = 0
        for r in recs:
            soap = r.get("soap") or {}
            total += sum(len(str(v)) for v in soap.values())
        return total / len(recs)

    sorted_recs = sorted(nurse_recs, key=lambda r: r["created_at"])
    recent_recs = sorted_recs[-min(5, len(sorted_recs)):]
    older_recs = sorted_recs[:-min(5, len(sorted_recs))] if len(sorted_recs) > 5 else []

    if older_recs:
        recent_avg = avg_soap_length(recent_recs)
        older_avg = avg_soap_length(older_recs)
        if older_avg > 0 and recent_avg < older_avg * 0.6:
            indicators.append({
                "type": "quality_decline",
                "label": "紀錄品質下降",
                "description": f"近期 SOAP 平均字數（{int(recent_avg)}字）較歷史平均（{int(older_avg)}字）下降超過 40%",
                "count": int((1 - recent_avg / older_avg) * 100),
                "severity": "warning",
            })
            stress_score += 10

    stress_score = min(stress_score, 100)
    if stress_score >= 70:
        stress_level = "critical"
    elif stress_score >= 45:
        stress_level = "high"
    elif stress_score >= 20:
        stress_level = "medium"
    else:
        stress_level = "low"

    care_messages = {
        "critical": f"💙 {nurse_name}，系統偵測到你最近工作壓力很大。你的付出我們都看見了，請記得照顧自己，必要時和護理長聊聊。",
        "high":     f"💛 {nurse_name}，你最近工作很努力。記得適時休息，喝杯水、深呼吸，你照顧好自己，才能照顧好病患。",
        "medium":   f"🌿 {nurse_name}，工作辛苦了。注意休息，保持良好的工作節奏。",
        "low":      f"✨ {nurse_name}，你的工作狀態看起來不錯，繼續保持！",
    }
    care_message = care_messages[stress_level]
    if work_days >= 5:
        care_message += f" 你已連續 {work_days} 天有工作紀錄。"
    if late_night_recs:
        care_message += f" 有 {len(late_night_recs)} 次深夜補寫紀錄，請注意作息。"

    return {
        "nurse_id": nurse_id,
        "nurse_name": nurse_name,
        "stress_level": stress_level,
        "stress_score": stress_score,
        "indicators": indicators,
        "care_message": care_message,
        "days_analyzed": days,
        "total_records": len(nurse_recs),
        "work_days": work_days,
    }


@app.get("/workload")
def api_workload(
    date: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """
    護理師工作負荷統計（護理長儀表板用）。

    統計每位護理師在指定日期（預設今天）的：
    - record_count  — SOAP 紀錄數
    - alert_count   — 觸發安全警示次數
    - high_risk_patients — 負責的高風險病患數（有警示的病患）
    - patient_ids   — 負責的病患 ID 集合

    回傳格式：
        {
          "date": "2026-05-31",
          "nurses": [
            {
              "nurse_id": "N001",
              "nurse_name": "王小明",
              "record_count": 8,
              "alert_count": 3,
              "high_risk_patients": 2,
              "load_level": "high"   # low / medium / high / overload
            },
            ...
          ]
        }
    """
    # 預設今天
    target_date = date or datetime.now(timezone.utc).strftime("%Y-%m-%d")

    all_recs = records.list_records(date_filter=target_date, page=1, page_size=1000)
    rec_list = all_recs.get("records", [])

    # 以 nurse_id 為 key 彙整統計
    nurse_stats: dict[str, dict] = {}

    for r in rec_list:
        nid = r.get("nurse_id") or "unknown"
        nname = r.get("nurse_name") or nid

        if nid not in nurse_stats:
            nurse_stats[nid] = {
                "nurse_id": nid,
                "nurse_name": nname,
                "record_count": 0,
                "alert_count": 0,
                "patient_ids": set(),
                "alerted_patient_ids": set(),
            }

        s = nurse_stats[nid]
        s["record_count"] += 1
        s["patient_ids"].add(r.get("patient_id", ""))

        # 計算警示數（優先用 alerts 陣列，fallback 到 warnings）
        alert_items = r.get("alerts") or []
        warning_items = r.get("warnings") or []
        n_alerts = len(alert_items) if alert_items else len(warning_items)
        s["alert_count"] += n_alerts

        if n_alerts > 0:
            s["alerted_patient_ids"].add(r.get("patient_id", ""))

    # 計算負荷等級並序列化 set → int
    result_nurses = []
    for s in nurse_stats.values():
        rc = s["record_count"]
        ac = s["alert_count"]
        hp = len(s["alerted_patient_ids"])

        # 負荷等級判斷（可依醫院實際情況調整閾值）
        if rc >= 15 or ac >= 8:
            load_level = "overload"   # 過載（紅）
        elif rc >= 10 or ac >= 5:
            load_level = "high"       # 高負荷（橙）
        elif rc >= 5 or ac >= 2:
            load_level = "medium"     # 中等（黃）
        else:
            load_level = "low"        # 輕鬆（綠）

        result_nurses.append({
            "nurse_id": s["nurse_id"],
            "nurse_name": s["nurse_name"],
            "record_count": rc,
            "alert_count": ac,
            "high_risk_patients": hp,
            "patient_count": len(s["patient_ids"]),
            "load_level": load_level,
        })

    # 按紀錄數降序排列（最忙的在前面）
    result_nurses.sort(key=lambda x: x["record_count"], reverse=True)

    return {
        "date": target_date,
        "nurses": result_nurses,
    }


# ══════════════════════════════════════════════════════════
# 知情同意 API（/consent/*）
# ══════════════════════════════════════════════════════════

class ConsentActionReq(BaseModel):
    """知情同意操作請求格式"""
    action: str   # "consent" | "declined" | "withdrawn"
    notes: str = ""

    @field_validator("action")
    @classmethod
    def action_must_be_valid(cls, v):
        valid = {"consent", "declined", "withdrawn"}
        if v not in valid:
            raise ValueError(f"action 必須是 {valid} 之一")
        return v


@app.get("/consent/patient/{patient_id}", response_model=ConsentStatusResponse)
def api_get_consent_status(
    patient_id: str,
    user: dict = Depends(get_current_user),
):
    """
    查詢指定病患的最新知情同意狀態。
    無紀錄時回傳 pending 狀態。
    需要 JWT 驗證。
    """
    # 確認病患存在
    all_patients = list_patients()
    if not any(p["id"] == patient_id for p in all_patients):
        raise HTTPException(404, "病患不存在")

    return consent.get_consent_status(patient_id)


@app.post("/consent/patient/{patient_id}", response_model=ConsentRecord)
def api_create_consent_record(
    patient_id: str,
    req: ConsentActionReq,
    user: dict = Depends(get_current_user),
):
    """
    建立一筆知情同意紀錄（同意 / 拒絕 / 撤回）。
    需要 JWT 驗證。
    """
    # 確認病患存在
    all_patients = list_patients()
    if not any(p["id"] == patient_id for p in all_patients):
        raise HTTPException(404, "病患不存在")

    # action → ConsentStatus 映射
    action_map = {
        "consent": ConsentStatus.consented,
        "declined": ConsentStatus.declined,
        "withdrawn": ConsentStatus.withdrawn,
    }
    status = action_map[req.action]

    return consent.create_consent_record(
        patient_id=patient_id,
        nurse_id=user["employee_id"],
        status=status,
        notes=req.notes,
    )


@app.get("/consent/patients/status", response_model=list[ConsentSummary])
def api_get_all_consent_status(user: dict = Depends(get_current_user)):
    """
    批次查詢所有病患的知情同意狀態摘要。
    需要 JWT 驗證。
    """
    return consent.get_all_patients_consent_status()


@app.get("/consent/audit-log", response_model=list[ConsentAuditEntry])
def api_get_consent_audit_log(
    patient_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """
    查詢知情同意稽核日誌，支援依病患 ID 或日期範圍篩選。
    需要 JWT 驗證。
    """
    return consent.get_audit_log(
        patient_id=patient_id,
        date_from=date_from,
        date_to=date_to,
    )


# ══════════════════════════════════════════════════════════
# 健康檢查
# ══════════════════════════════════════════════════════════

@app.get("/health")
def health():
    """健康檢查端點，用於確認後端服務是否正常運行"""
    return {"status": "ok"}

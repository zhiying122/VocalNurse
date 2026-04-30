"""
VoiceNursy 資料模型定義（Pydantic Schema）

本檔案定義所有 API 的輸入/輸出資料格式，使用 Pydantic BaseModel。
FastAPI 會自動根據這些 Schema 進行：
- 請求資料驗證（型別檢查、範圍限制等）
- 回應資料序列化（自動轉 JSON）
- API 文件生成（Swagger UI）

資料流向：
    前端 → STTInput → Brain 模組 → BrainOutput → 前端顯示
    前端 → RecordCreate → Records 模組 → RecordResponse → 前端顯示
"""
from pydantic import BaseModel, Field
from typing import Optional


# ══════════════════════════════════════════════════════════
# 語音辨識輸入
# ══════════════════════════════════════════════════════════

class STTInput(BaseModel):
    """
    語音辨識後的原始文字輸入。
    前端錄音 → STT 辨識 → 將辨識結果以此格式送到 /brain/process
    """
    raw_text: str = Field(..., description="語音辨識後的原始文字（中英台混合）")


# ══════════════════════════════════════════════════════════
# 藥物實體
# ══════════════════════════════════════════════════════════

class MedicationEntity(BaseModel):
    """
    單一藥物的結構化資料。
    由 LLM 從護理師口述中提取並標準化。

    範例：
        name="Acetaminophen", dose="500", unit="mg", route="PO"
        對應口述：「普拿疼五百毫克口服」
    """
    name: str = Field(..., description="標準化藥物名稱（英文）")
    dose: Optional[str] = Field(None, description="劑量數字，如 '500'")
    unit: Optional[str] = Field(None, description="單位，如 'mg'、'顆'、'ml'")
    route: Optional[str] = Field(None, description="給藥途徑，如 'PO'（口服）、'IV'（靜脈）、'PRN'（需要時）")
    raw: str = Field(..., description="原始辨識文字，供除錯用")


# ══════════════════════════════════════════════════════════
# SOAP 護理紀錄結構
# ══════════════════════════════════════════════════════════

class SOAPEntry(BaseModel):
    """
    SOAP 護理紀錄的四個欄位。
    SOAP 是護理紀錄的標準格式：

    S (Subjective) — 主觀資料：病患或家屬說的話、主訴、感受
    O (Objective)  — 客觀資料：測量數值（BP/HR/BT/SpO2）、傷口觀察、意識狀態
    A (Assessment) — 評估：根據 S 和 O 做出的護理判斷
    P (Plan)       — 計畫：已執行或預計執行的處置、給藥、追蹤計畫
    """
    subjective: str = Field(..., description="S：病患主訴、主觀感受")
    objective: str = Field(..., description="O：客觀數值，如生命徵象、傷口描述")
    assessment: str = Field(..., description="A：護理評估與判斷")
    plan: str = Field(..., description="P：護理計畫與處置")


# ══════════════════════════════════════════════════════════
# Brain 模組輸出（LLM 生成的完整 SOAP 結果）
# ══════════════════════════════════════════════════════════

class BrainOutput(BaseModel):
    """
    LLM 生成的完整 SOAP 輸出，包含：
    - SOAP 四欄位
    - 提取的藥物列表
    - 疼痛指數
    - AI 偵測到的潛在問題（warnings）
    - 原始輸入文字（供除錯）
    """
    soap: SOAPEntry
    medications: list[MedicationEntity] = Field(default_factory=list)
    pain_scale: Optional[int] = Field(None, ge=0, le=10, description="疼痛指數 0-10，沒提到則為 null")
    warnings: list[str] = Field(default_factory=list, description="AI 發現的潛在問題")
    raw_text: str = Field(..., description="原始輸入文字，供除錯用")


# ══════════════════════════════════════════════════════════
# 【新增】共享護理紀錄 Schema
#
# 這兩個 Schema 是「共享護理紀錄」功能的資料格式：
# - RecordCreate   — 前端送出的儲存請求格式
# - RecordResponse — 後端回傳的完整紀錄格式（含系統產生的欄位）
# ══════════════════════════════════════════════════════════

class RecordCreate(BaseModel):
    """
    新增護理紀錄的請求格式。

    前端 confirmSave() 會組裝此格式的 JSON，POST 到 /records。
    注意：nurse_id 和 nurse_name 不在此 Schema 中，
    因為這兩個欄位是從 JWT token 自動提取的，不需要前端傳送。
    """
    patient_id: str = Field(..., description="病患 ID（例如 'P8EE7C3'）")
    soap: SOAPEntry                                                         # SOAP 四欄位
    medications: list[MedicationEntity] = Field(default_factory=list)        # 藥物列表
    pain_scale: Optional[int] = Field(None, ge=0, le=10, description="疼痛指數 0-10")
    warnings: list[str] = Field(default_factory=list, description="AI 發現的潛在問題")
    raw_text: str = Field("", description="原始語音辨識文字")
    shift: str = Field("", description="班別：日班、小夜班、大夜班")


class RecordResponse(BaseModel):
    """
    護理紀錄的完整回應格式。

    包含 RecordCreate 的所有欄位，加上系統自動產生的：
    - id         — 紀錄唯一識別碼（R + 6 位 hex，例如 "R3A5B2C"）
    - nurse_id   — 建立者員工編號（從 JWT 提取）
    - nurse_name — 建立者姓名（從 JWT 提取，直接顯示在前端）
    - created_at — 建立時間（ISO 8601 UTC 格式）
    """
    id: str = Field(..., description="紀錄 ID（R + 6 位 hex，例如 'R3A5B2C'）")
    patient_id: str = Field(..., description="病患 ID")
    soap: SOAPEntry
    medications: list[MedicationEntity] = Field(default_factory=list)
    pain_scale: Optional[int] = Field(None, ge=0, le=10, description="疼痛指數 0-10")
    warnings: list[str] = Field(default_factory=list, description="AI 發現的潛在問題")
    raw_text: str = Field("", description="原始語音辨識文字")
    shift: str = Field("", description="班別：日班、小夜班、大夜班")
    nurse_id: str = Field(..., description="建立者員工編號（從 JWT 自動提取）")
    nurse_name: str = Field(..., description="建立者姓名（從 JWT 自動提取）")
    created_at: str = Field(..., description="建立時間（ISO 8601 UTC 格式）")

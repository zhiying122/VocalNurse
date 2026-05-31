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
import re
from pydantic import BaseModel, Field, field_validator
from typing import Optional


# ══════════════════════════════════════════════════════════
# 語音辨識輸入
# ══════════════════════════════════════════════════════════

class STTInput(BaseModel):
    """
    語音辨識後的原始文字輸入。
    前端錄音 → STT 辨識 → 將辨識結果以此格式送到 /brain/process
    """
    raw_text: str = Field(
        ...,
        min_length=1,
        description="語音辨識後的原始文字（中英台混合），至少 1 個字元",
    )


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

    # 劑量格式驗證：若有提供，必須是數字（可含小數點）
    @field_validator("dose")
    @classmethod
    def validate_dose_format(cls, v):
        if v is not None and v != "":
            # 允許的格式：純數字、帶小數點的數字（例如 "500", "0.25", "1.5"）
            if not re.match(r"^\d+(\.\d+)?$", v.strip()):
                raise ValueError("劑量格式不正確，應為數字（可含小數點），例如 '500' 或 '0.25'")
        return v


# ══════════════════════════════════════════════════════════
# SOAP 護理紀錄結構
# ══════════════════════════════════════════════════════════

class SOAPEntry(BaseModel):
    """
    SOAP 護理紀錄的四個欄位。

    S (Subjective) — 主觀資料：病患或家屬說的話、主訴、感受
    O (Objective)  — 客觀資料：測量數值（BP/HR/BT/SpO2）、傷口觀察、意識狀態
    A (Assessment) — 評估：根據 S 和 O 做出的護理判斷
    P (Plan)       — 計畫：已執行或預計執行的處置、給藥、追蹤計畫

    每個欄位最大長度 5000 字元，防止過大的輸入。
    """
    subjective: str = Field(..., max_length=5000, description="S：病患主訴、主觀感受")
    objective: str = Field(..., max_length=5000, description="O：客觀數值，如生命徵象、傷口描述")
    assessment: str = Field(..., max_length=5000, description="A：護理評估與判斷")
    plan: str = Field(..., max_length=5000, description="P：護理計畫與處置")


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
# 安全警示結構
# ══════════════════════════════════════════════════════════

class AlertEntry(BaseModel):
    """
    單一安全警示的結構化資料。
    由前端防呆引擎產生，隨紀錄一起儲存到後端。

    欄位說明：
        type     — 警示類型（allergy / dosage_exceeded / vital_abnormal / drug_interaction）
        severity — 嚴重程度（critical / warning）
        item     — 觸發警示的項目（藥物名稱或生命徵象名稱）
        detected — 偵測到的值（例如 "1500 mg"）
        range    — 正常範圍（例如 "最大單次 1000 mg"）
        message  — 警示訊息（中文，直接顯示在前端）
    """
    type: str = Field("", description="警示類型")
    severity: str = Field("", description="嚴重程度：critical 或 warning")
    item: str = Field("", description="觸發警示的項目")
    detected: str = Field("", description="偵測到的值")
    range: str = Field("", description="正常範圍")
    message: str = Field("", description="警示訊息")


# ══════════════════════════════════════════════════════════
# 共享護理紀錄 Schema
# ══════════════════════════════════════════════════════════

class RecordCreate(BaseModel):
    """
    新增護理紀錄的請求格式。

    前端 confirmSave() 會組裝此格式的 JSON，POST 到 /records。
    注意：nurse_id 和 nurse_name 不在此 Schema 中，
    因為這兩個欄位是從 JWT token 自動提取的。
    """
    patient_id: str = Field(..., description="病患 ID（例如 'P8EE7C3'）")
    soap: SOAPEntry                                                         # SOAP 四欄位
    medications: list[MedicationEntity] = Field(default_factory=list)        # 藥物列表
    pain_scale: Optional[int] = Field(None, ge=0, le=10, description="疼痛指數 0-10")
    warnings: list[str] = Field(default_factory=list, description="AI 發現的潛在問題")
    raw_text: str = Field("", description="原始語音辨識文字")
    shift: str = Field("", description="班別：日班、小夜班、大夜班")
    alerts: list[AlertEntry] = Field(default_factory=list, description="安全警示列表")


class RecordResponse(BaseModel):
    """
    護理紀錄的完整回應格式。

    包含 RecordCreate 的所有欄位，加上系統自動產生的：
    - id         — 紀錄唯一識別碼（R + 6 位 hex）
    - nurse_id   — 建立者員工編號（從 JWT 提取）
    - nurse_name — 建立者姓名（從 JWT 提取）
    - created_at — 建立時間（ISO 8601 UTC 格式）
    - consent_id — 對應的知情同意紀錄 ID（可選）
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
    alerts: list[AlertEntry] = Field(default_factory=list, description="安全警示列表")
    consent_id: Optional[str] = Field(None, description="對應的知情同意紀錄 ID（可選）")


class RecordUpdate(BaseModel):
    """
    編輯護理紀錄的請求格式。
    僅允許更新部分欄位：soap、medications、pain_scale、warnings。
    使用 Optional 讓前端只需傳送要更新的欄位。
    """
    soap: Optional[SOAPEntry] = None
    medications: Optional[list[MedicationEntity]] = None
    pain_scale: Optional[int] = Field(None, ge=0, le=10)
    warnings: Optional[list[str]] = None


# ══════════════════════════════════════════════════════════
# IRB 知情同意（Informed Consent）相關模型
# ══════════════════════════════════════════════════════════

from enum import Enum


class ConsentStatus(str, Enum):
    """
    病患知情同意狀態。
    - pending:   尚未進行同意程序（預設狀態）
    - consented: 病患已同意
    - declined:  病患已拒絕
    - withdrawn: 病患已撤回同意
    """
    pending = "pending"
    consented = "consented"
    declined = "declined"
    withdrawn = "withdrawn"


class ConsentSection(BaseModel):
    """
    知情同意書的單一段落。
    """
    id: str = Field(..., description="段落唯一識別碼，例如 'purpose'")
    heading: str = Field(..., description="段落標題，例如 '研究目的'")
    content: str = Field(..., description="段落內容文字")


class ConsentConfig(BaseModel):
    """
    知情同意書設定，從 consent_config.json 載入。
    包含版本號、標題、生效日期及各段落內容。
    """
    version: str = Field(..., description="同意書版本號，格式 v{major}.{minor}，例如 'v1.0'")
    effective_date: str = Field(..., description="生效日期，格式 YYYY-MM-DD")
    title: str = Field(..., description="同意書標題")
    sections: list[ConsentSection] = Field(..., description="同意書各段落列表")


class ConsentRecord(BaseModel):
    """
    單筆知情同意紀錄，持久化儲存至 consents.json。
    採 Append-Only 設計，不允許修改或刪除歷史紀錄。
    """
    id: str = Field(..., description="紀錄唯一識別碼（C + 6 位大寫 hex，例如 'C3A5B2'）")
    patient_id: str = Field(..., description="病患 ID")
    nurse_id: str = Field(..., description="操作護理師員工編號")
    consent_version: str = Field(..., description="同意書版本號，例如 'v1.0'")
    status: ConsentStatus = Field(..., description="同意狀態")
    created_at: str = Field(..., description="建立時間（ISO 8601 UTC 格式）")
    notes: str = Field("", description="備註（可選）")


class ConsentStatusResponse(BaseModel):
    """
    查詢病患同意狀態的回應格式（GET /consent/patient/{patient_id}）。
    包含版本比對結果，供前端判斷是否需要重新取得同意。
    """
    patient_id: str = Field(..., description="病患 ID")
    status: ConsentStatus = Field(..., description="目前同意狀態")
    consent_version: str = Field(..., description="病患同意時的版本號（或目前系統版本號）")
    version_match: bool = Field(..., description="病患同意版本是否與目前系統版本相符")
    last_updated: Optional[str] = Field(None, description="最後更新時間（ISO 8601 UTC）")
    nurse_id: Optional[str] = Field(None, description="最後操作護理師員工編號")


class ConsentSummary(BaseModel):
    """
    病患同意狀態摘要，用於批次查詢（GET /consent/patients/status）。
    """
    patient_id: str = Field(..., description="病患 ID")
    status: ConsentStatus = Field(..., description="目前同意狀態")
    consent_version: Optional[str] = Field(None, description="同意書版本號")
    last_updated: Optional[str] = Field(None, description="最後更新時間（ISO 8601 UTC）")


class ConsentAuditEntry(BaseModel):
    """
    知情同意稽核日誌條目，持久化儲存至 consent_audit.json。
    記錄所有同意相關操作，供 IRB 稽核使用。
    """
    id: str = Field(..., description="稽核條目唯一識別碼")
    event_type: str = Field(..., description="事件類型：consent_shown / consented / declined / withdrawn / validation_failed")
    patient_id: str = Field(..., description="病患 ID")
    nurse_id: str = Field(..., description="操作護理師員工編號")
    consent_version: str = Field(..., description="同意書版本號")
    timestamp: str = Field(..., description="事件時間（ISO 8601 UTC 格式）")
    notes: str = Field("", description="備註（可選）")

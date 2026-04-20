"""
輸入／輸出 Schema 定義
A 傳入 raw_text，B 產出結構化 SOAP JSON 給 C
"""
from pydantic import BaseModel, Field
from typing import Optional


# ── 來自 A 的輸入 ──────────────────────────────────────────
class STTInput(BaseModel):
    raw_text: str = Field(..., description="語音辨識後的原始文字（中英台混合）")


# ── 藥物實體 ───────────────────────────────────────────────
class MedicationEntity(BaseModel):
    name: str = Field(..., description="標準化藥物名稱")
    dose: Optional[str] = Field(None, description="劑量數字，如 '500'")
    unit: Optional[str] = Field(None, description="單位，如 'mg'、'顆'、'ml'")
    route: Optional[str] = Field(None, description="給藥途徑，如 'PO'、'IV'、'PRN'")
    raw: str = Field(..., description="原始辨識文字，供除錯用")


# ── SOAP 結構 ──────────────────────────────────────────────
class SOAPEntry(BaseModel):
    subjective: str = Field(..., description="S：病患主訴、主觀感受")
    objective: str = Field(..., description="O：客觀數值，如生命徵象、傷口描述")
    assessment: str = Field(..., description="A：護理評估與判斷")
    plan: str = Field(..., description="P：護理計畫與處置")


# ── 傳給 C 的完整輸出 ──────────────────────────────────────
class BrainOutput(BaseModel):
    soap: SOAPEntry
    medications: list[MedicationEntity] = Field(default_factory=list)
    pain_scale: Optional[int] = Field(None, ge=0, le=10, description="疼痛指數 0-10")
    warnings: list[str] = Field(default_factory=list, description="AI 發現的潛在問題")
    raw_text: str = Field(..., description="原始輸入，供 C 除錯用")

"""
Brain Layer 主邏輯
接收 A 的 raw_text → PII 遮罩 → 前處理 → LLM → 驗證 → 輸出給 C
"""
from schemas import STTInput, BrainOutput, SOAPEntry, MedicationEntity
from correction_dict import preprocess
from pii_redactor import redact_pii
from prompts import SYSTEM_PROMPT, USER_PROMPT_TEMPLATE
from llm_client import call_llm


def _parse_medication(med: dict) -> dict:
    """
    容錯解析藥物欄位。
    LLM 有時會把 dose 和 unit 混在一起（如 "500mg"），
    這裡自動拆分，確保 Pydantic 驗證通過。
    """
    import re as _re
    med = dict(med)  # 複製，不修改原始資料

    dose = str(med.get("dose") or "").strip()
    unit = str(med.get("unit") or "").strip()

    # 如果 dose 包含非數字字元（如 "500mg", "0.5g"），嘗試拆分
    if dose and not _re.match(r"^\d+(\.\d+)?$", dose):
        m = _re.match(r"^([\d.]+)\s*([a-zA-Z%μ顆片支袋瓶cc]+)$", dose)
        if m:
            med["dose"] = m.group(1)
            if not unit:
                med["unit"] = m.group(2)
        else:
            # 無法解析，清空 dose 避免驗證失敗
            med["dose"] = None

    # 確保必填欄位 raw 存在
    if not med.get("raw"):
        med["raw"] = med.get("name", "")

    return med


def process(input_data: STTInput) -> BrainOutput:
    """
    主處理流程：
    1. PII 遮罩（身分證、電話、姓名等）
    2. 前處理（藥名標準化、縮寫統一）
    3. 呼叫 LLM 生成 SOAP JSON
    4. 驗證並封裝為 BrainOutput
    """
    # Step 1：PII 遮罩
    safe_text = redact_pii(input_data.raw_text)

    # Step 2：前處理
    preprocessed = preprocess(safe_text)

    # Step 3：呼叫 LLM
    user_prompt = USER_PROMPT_TEMPLATE.format(preprocessed_text=preprocessed)
    raw_json = call_llm(SYSTEM_PROMPT, user_prompt)

    # Step 4：封裝輸出（含容錯處理）
    soap = SOAPEntry(**raw_json["soap"])

    medications = []
    for med in raw_json.get("medications", []):
        try:
            medications.append(MedicationEntity(**_parse_medication(med)))
        except Exception as e:
            print(f"[Brain] 藥物解析失敗，略過：{med} ({e})")

    return BrainOutput(
        soap=soap,
        medications=medications,
        pain_scale=raw_json.get("pain_scale"),
        warnings=raw_json.get("warnings", []),
        raw_text=input_data.raw_text,
    )

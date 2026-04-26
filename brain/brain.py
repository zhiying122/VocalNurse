"""
Brain Layer 主邏輯
接收 A 的 raw_text → PII 遮罩 → 前處理 → LLM → 驗證 → 輸出給 C
"""
from schemas import STTInput, BrainOutput, SOAPEntry, MedicationEntity
from correction_dict import preprocess
from pii_redactor import redact_pii
from prompts import SYSTEM_PROMPT, USER_PROMPT_TEMPLATE
from llm_client import call_llm


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

    # Step 4：封裝輸出
    soap = SOAPEntry(**raw_json["soap"])

    medications = [
        MedicationEntity(**med)
        for med in raw_json.get("medications", [])
    ]

    return BrainOutput(
        soap=soap,
        medications=medications,
        pain_scale=raw_json.get("pain_scale"),
        warnings=raw_json.get("warnings", []),
        raw_text=input_data.raw_text,
    )

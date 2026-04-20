"""
Brain Layer 主邏輯
接收 A 的 raw_text → 前處理 → LLM → 驗證 → 輸出給 C
"""
from schemas import STTInput, BrainOutput, SOAPEntry, MedicationEntity
from correction_dict import preprocess
from prompts import SYSTEM_PROMPT, USER_PROMPT_TEMPLATE
from llm_client import call_llm


def process(input_data: STTInput) -> BrainOutput:
    """
    主處理流程：
    1. 前處理（藥名標準化、縮寫統一）
    2. 呼叫 LLM 生成 SOAP JSON
    3. 驗證並封裝為 BrainOutput
    """
    # Step 1：前處理
    preprocessed = preprocess(input_data.raw_text)

    # Step 2：呼叫 LLM
    user_prompt = USER_PROMPT_TEMPLATE.format(preprocessed_text=preprocessed)
    raw_json = call_llm(SYSTEM_PROMPT, user_prompt)

    # Step 3：封裝輸出（Pydantic 自動驗證）
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

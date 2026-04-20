"""
FastAPI 端點：供 A 呼叫傳入 raw_text，回傳結構化 JSON 給 C
"""
from fastapi import FastAPI, HTTPException
from schemas import STTInput, BrainOutput
from brain import process

app = FastAPI(
    title="VoiceNursy Brain Layer",
    description="接收語音轉錄文字，輸出結構化 SOAP JSON",
    version="0.1.0",
)


@app.post("/brain/process", response_model=BrainOutput)
def process_text(input_data: STTInput) -> BrainOutput:
    """
    接收 A 傳來的 raw_text，回傳完整 SOAP + 藥物資訊給 C

    範例輸入：
    ```json
    {"raw_text": "阿公今天傷口發紅，pain scale 4分，PRN 給一顆 Voren，BP 140/90"}
    ```
    """
    try:
        return process(input_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
def health():
    return {"status": "ok"}

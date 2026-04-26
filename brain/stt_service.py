"""
後端 STT 服務：接收前端上傳的音檔，用 Faster-Whisper 本地轉錄
"""
import os
import tempfile

# 醫療專用 prompt
MEDICAL_PROMPT = (
    "這是一段台灣醫院的護理記錄，包含中英文醫學術語。"
    "常見詞彙：Voren, Voltaren, Acetaminophen, Aspirin, Amlodipine, Furosemide, "
    "NPO, On Foley, NG tube, 換藥, 引流, 抽痰, 翻身, "
    "BP, HR, RR, BT, SpO2, GCS, pain scale, PRN, QD, BID, TID, QID, "
    "PO, IV, IM, SC, 普拿疼, 阿斯匹靈, 脈優, 耐適恩"
)

_model = None


def _get_model():
    global _model
    if _model is None:
        try:
            from faster_whisper import WhisperModel
            model_size = os.getenv("WHISPER_MODEL_SIZE", "base")
            _model = WhisperModel(model_size, device="cpu", compute_type="int8")
            print(f"[STT] Faster-Whisper {model_size} 模型已載入")
        except ImportError:
            print("[STT] faster-whisper 未安裝，嘗試使用 whisper")
            import whisper
            _model = whisper.load_model("base")
            print("[STT] OpenAI Whisper base 模型已載入")
    return _model


def transcribe_audio(audio_bytes: bytes, filename: str = "audio.wav") -> dict:
    """
    轉錄音檔

    Args:
        audio_bytes: 音檔二進位資料
        filename: 原始檔名（用於判斷格式）

    Returns:
        {"text": "轉錄文字", "language": "zh", "confidence": 0.95}
    """
    # 寫入暫存檔
    suffix = os.path.splitext(filename)[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        model = _get_model()

        # 判斷是 faster-whisper 還是 openai-whisper
        if hasattr(model, 'transcribe') and hasattr(model, 'model'):
            # openai-whisper
            result = model.transcribe(
                tmp_path,
                language="zh",
                initial_prompt=MEDICAL_PROMPT,
            )
            return {
                "text": result["text"].strip(),
                "language": result.get("language", "zh"),
                "confidence": 0.9,
            }
        else:
            # faster-whisper
            segments, info = model.transcribe(
                tmp_path,
                language="zh",
                beam_size=5,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=500),
                initial_prompt=MEDICAL_PROMPT,
            )
            text = "".join(seg.text for seg in segments)
            return {
                "text": text.strip(),
                "language": info.language,
                "confidence": round(info.language_probability, 2),
            }
    finally:
        os.unlink(tmp_path)

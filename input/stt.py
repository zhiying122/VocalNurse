"""
語音轉文字 (STT)：支援 Faster-Whisper（本地）與 OpenAI Whisper API（雲端）
含醫療專用 prompt 優化、音檔分段並行處理
"""
import os
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv

load_dotenv()

STT_ENGINE = os.getenv("STT_ENGINE", "faster_whisper")

# 醫療專用 initial_prompt，大幅提升中英台混種辨識率
MEDICAL_PROMPT = (
    "這是一段台灣醫院的護理記錄，包含中英文醫學術語。"
    "常見詞彙：Voren, Voltaren, Acetaminophen, Aspirin, Amlodipine, Furosemide, Lasix, Nexium, "
    "NPO, On Foley, NG tube, 換藥, 引流, 抽痰, 翻身, "
    "BP, HR, RR, BT, SpO2, GCS, pain scale, PRN, QD, BID, TID, QID, "
    "PO, IV, IM, SC, SOS, "
    "普拿疼, 阿斯匹靈, 脈優, 耐適恩, 服樂泄, "
    "收縮壓, 舒張壓, 血氧, 心跳, 體溫, 呼吸次數"
)


def stt_faster_whisper(filepath: str) -> str:
    """使用 Faster-Whisper 本地模型轉錄（含醫療 prompt）"""
    from faster_whisper import WhisperModel

    model_size = os.getenv("WHISPER_MODEL_SIZE", "base")
    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    segments, info = model.transcribe(
        filepath,
        language="zh",
        beam_size=5,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500),
        initial_prompt=MEDICAL_PROMPT,
    )

    text = "".join(seg.text for seg in segments)
    print(f"[STT] Faster-Whisper | 語言：{info.language}（{info.language_probability:.2f}）")
    return text.strip()


def stt_whisper_api(filepath: str) -> str:
    """使用 OpenAI Whisper API 雲端轉錄（含醫療 prompt）"""
    from openai import OpenAI

    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    with open(filepath, "rb") as audio_file:
        transcript = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            language="zh",
            prompt=MEDICAL_PROMPT,
        )

    return transcript.text.strip()


def _stt_single(filepath: str) -> str:
    """單一檔案 STT"""
    if STT_ENGINE == "whisper_api":
        return stt_whisper_api(filepath)
    else:
        return stt_faster_whisper(filepath)


def stt_request(filepath: str) -> str:
    """
    STT 主入口：自動分段 + 並行處理
    """
    from vad import split_audio

    chunks = split_audio(filepath, max_duration=30.0)

    if len(chunks) == 1:
        return _stt_single(chunks[0])

    # 多段並行處理
    print(f"[STT] 分 {len(chunks)} 段並行處理")
    with ThreadPoolExecutor(max_workers=min(len(chunks), 4)) as pool:
        results = list(pool.map(_stt_single, chunks))

    # 清理暫存分段檔案
    for c in chunks:
        if c != filepath and os.path.exists(c):
            os.remove(c)

    return " ".join(results)

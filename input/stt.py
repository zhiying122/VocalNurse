"""
語音轉文字 (STT)：支援 Faster-Whisper（本地）與 OpenAI Whisper API（雲端）
"""
import os
from dotenv import load_dotenv

load_dotenv()

STT_ENGINE = os.getenv("STT_ENGINE", "faster_whisper")


def stt_faster_whisper(filepath: str) -> str:
    """使用 Faster-Whisper 本地模型轉錄"""
    from faster_whisper import WhisperModel

    model_size = os.getenv("WHISPER_MODEL_SIZE", "base")
    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    segments, info = model.transcribe(
        filepath,
        language="zh",           # 主要語言中文
        beam_size=5,
        vad_filter=True,         # 自動過濾靜音段
        vad_parameters=dict(
            min_silence_duration_ms=500,
        ),
    )

    text = "".join(seg.text for seg in segments)
    print(f"[STT] 偵測語言：{info.language}（信心度 {info.language_probability:.2f}）")
    return text.strip()


def stt_whisper_api(filepath: str) -> str:
    """使用 OpenAI Whisper API 雲端轉錄"""
    from openai import OpenAI

    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    with open(filepath, "rb") as audio_file:
        transcript = client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            language="zh",
            prompt="護理紀錄，中英台夾雜。BP HR SpO2 PRN QD BID Voren Acetaminophen",
        )

    return transcript.text.strip()


def stt_request(filepath: str) -> str:
    """
    STT 主入口：依設定選擇引擎
    """
    if STT_ENGINE == "whisper_api":
        return stt_whisper_api(filepath)
    else:
        return stt_faster_whisper(filepath)

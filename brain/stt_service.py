"""
後端 STT 服務：接收前端上傳的音檔，用 Whisper 本地轉錄
"""
import os
import tempfile
import subprocess
import uuid

MEDICAL_PROMPT = (
    "這是一段台灣醫院的護理記錄，包含中英文醫學術語。"
    "Voren, Voltaren, Acetaminophen, Aspirin, Amlodipine, Furosemide, "
    "NPO, On Foley, NG tube, 換藥, 引流, 抽痰, 翻身, "
    "BP, HR, RR, BT, SpO2, GCS, pain scale, PRN, QD, BID, TID, QID, "
    "PO, IV, IM, SC, 普拿疼, 阿斯匹靈, 脈優, 耐適恩"
)

_model = None


def _get_model():
    global _model
    if _model is None:
        import whisper
        model_size = os.getenv("WHISPER_MODEL_SIZE", "base")
        _model = whisper.load_model(model_size)
        print(f"[STT] Whisper {model_size} 模型已載入")
    return _model


def transcribe_audio(audio_bytes: bytes, filename: str = "audio.wav") -> dict:
    """轉錄音檔"""
    tmp_dir = tempfile.mkdtemp()
    uid = uuid.uuid4().hex[:8]
    suffix = os.path.splitext(filename)[1] or ".webm"
    input_path = os.path.join(tmp_dir, f"input_{uid}{suffix}")
    wav_path = os.path.join(tmp_dir, f"output_{uid}.wav")

    try:
        # 寫入原始音檔
        with open(input_path, "wb") as f:
            f.write(audio_bytes)

        # 轉成 16kHz mono wav
        try:
            result = subprocess.run(
                ["ffmpeg", "-y", "-i", input_path, "-ar", "16000", "-ac", "1", "-f", "wav", wav_path],
                capture_output=True, timeout=15, text=True,
            )
            if result.returncode != 0:
                print(f"[STT] ffmpeg 錯誤: {result.stderr[:200]}")
                # ffmpeg 失敗，直接用原檔
                wav_path = input_path
        except FileNotFoundError:
            print("[STT] ffmpeg 未安裝，直接用原檔")
            wav_path = input_path
        except subprocess.TimeoutExpired:
            print("[STT] ffmpeg 轉檔逾時")
            wav_path = input_path

        # Whisper 轉錄
        model = _get_model()
        transcription = model.transcribe(
            wav_path,
            language="zh",
            initial_prompt=MEDICAL_PROMPT,
            fp16=False,
        )

        text = transcription["text"].strip()
        print(f"[STT] 辨識結果: {text}")

        return {
            "text": text,
            "language": transcription.get("language", "zh"),
            "confidence": 0.9,
        }

    except Exception as e:
        print(f"[STT] 轉錄失敗: {e}")
        raise

    finally:
        # 清理暫存
        for f in [input_path, wav_path]:
            try:
                if os.path.exists(f):
                    os.unlink(f)
            except Exception:
                pass
        try:
            os.rmdir(tmp_dir)
        except Exception:
            pass

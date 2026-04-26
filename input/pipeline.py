"""
角色 A 完整流程：錄音 → 降噪 → 修剪 → STT（含 VAD 分段）→ 清理 → 傳給 B
"""
import json
from recorder import record_toggle
from denoiser import spectral_subtraction
from audio_trim import trim_silence
from stt import stt_request
from text_cleaner import clean
from send_to_brain import send_to_brain


def run_pipeline(audio_path: str = None) -> dict:
    """
    完整 Input Layer 流程

    Args:
        audio_path: 若提供音檔路徑則跳過錄音步驟
    """
    # Step 1：錄音
    if audio_path is None:
        print("\n=== Step 1：錄音 ===")
        audio_path = record_toggle()
        if not audio_path:
            print("錄音失敗")
            return {}

    # Step 2：環境噪音過濾
    print("\n=== Step 2：降噪 ===")
    audio_path = spectral_subtraction(audio_path)

    # Step 3：修剪頭尾靜音
    print("\n=== Step 3：修剪靜音 ===")
    audio_path = trim_silence(audio_path)

    # Step 4：語音轉文字（含 VAD 自動分段 + 並行處理）
    print("\n=== Step 4：語音轉文字 (STT) ===")
    raw_text = stt_request(audio_path)
    print(f"[STT 結果] {raw_text}")

    # Step 5：文字清理
    print("\n=== Step 5：文字清理 ===")
    cleaned_text = clean(raw_text)
    print(f"[清理結果] {cleaned_text}")

    # Step 6：傳送給 Brain (角色 B)
    print("\n=== Step 6：傳送給 Brain Layer ===")
    payload = {"raw_text": cleaned_text}
    print(f"[傳送] {json.dumps(payload, ensure_ascii=False)}")
    result = send_to_brain(cleaned_text)

    if result:
        print("\n=== Brain 回傳結果 ===")
        print(json.dumps(result, ensure_ascii=False, indent=2))

    return result


if __name__ == "__main__":
    run_pipeline()

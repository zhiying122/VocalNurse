"""
音檔優化：自動修剪頭尾空白音段，減少傳送大小
"""
import numpy as np
import soundfile as sf


def trim_silence(filepath: str, threshold: float = 0.01, margin: float = 0.3) -> str:
    """
    修剪音檔頭尾的靜音段

    Args:
        filepath: 原始音檔路徑
        threshold: 音量閾值，低於此值視為靜音
        margin: 保留的邊界秒數（避免剪太緊）

    Returns:
        修剪後的音檔路徑（覆蓋原檔）
    """
    audio, sr = sf.read(filepath)

    # 計算每個 sample 的絕對振幅
    if audio.ndim > 1:
        amplitude = np.max(np.abs(audio), axis=1)
    else:
        amplitude = np.abs(audio)

    # 找到第一個和最後一個超過閾值的位置
    non_silent = np.where(amplitude > threshold)[0]

    if len(non_silent) == 0:
        print("[修剪] 整段音檔都是靜音")
        return filepath

    start = max(0, non_silent[0] - int(margin * sr))
    end = min(len(audio), non_silent[-1] + int(margin * sr))

    trimmed = audio[start:end]
    original_duration = len(audio) / sr
    trimmed_duration = len(trimmed) / sr

    sf.write(filepath, trimmed, sr)
    print(f"[修剪] {original_duration:.1f}s → {trimmed_duration:.1f}s（省去 {original_duration - trimmed_duration:.1f}s 靜音）")
    return filepath

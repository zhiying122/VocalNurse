"""
Voice Activity Detection (VAD)
偵測語音活動，自動在護理師停止說話 1.5 秒後截斷
支援音檔分段處理（超過 30 秒自動切片）
"""
import numpy as np
import soundfile as sf
import os


def detect_voice_segments(
    filepath: str,
    energy_threshold: float = 0.02,
    silence_duration: float = 1.5,
    min_speech_duration: float = 0.5,
) -> list[tuple[float, float]]:
    """
    偵測音檔中的語音段落

    Args:
        filepath: 音檔路徑
        energy_threshold: 能量閾值，低於此值視為靜音
        silence_duration: 靜音超過此秒數則截斷
        min_speech_duration: 最短語音段落（過短的忽略）

    Returns:
        語音段落清單 [(start_sec, end_sec), ...]
    """
    audio, sr = sf.read(filepath)
    if audio.ndim > 1:
        audio = audio[:, 0]

    # 計算短時能量（每 20ms 一個窗格）
    frame_len = int(0.02 * sr)
    n_frames = len(audio) // frame_len
    energy = np.array([
        np.sqrt(np.mean(audio[i * frame_len:(i + 1) * frame_len] ** 2))
        for i in range(n_frames)
    ])

    # 標記語音/靜音
    is_speech = energy > energy_threshold
    segments = []
    in_speech = False
    start = 0
    silence_frames = int(silence_duration / 0.02)

    silent_count = 0
    for i, speech in enumerate(is_speech):
        if speech:
            if not in_speech:
                start = i
                in_speech = True
            silent_count = 0
        else:
            if in_speech:
                silent_count += 1
                if silent_count >= silence_frames:
                    end = i - silence_frames
                    duration = (end - start) * 0.02
                    if duration >= min_speech_duration:
                        segments.append((start * 0.02, end * 0.02))
                    in_speech = False
                    silent_count = 0

    # 處理最後一段
    if in_speech:
        duration = (n_frames - start) * 0.02
        if duration >= min_speech_duration:
            segments.append((start * 0.02, n_frames * 0.02))

    print(f"[VAD] 偵測到 {len(segments)} 段語音")
    return segments


def split_audio(filepath: str, max_duration: float = 30.0) -> list[str]:
    """
    將音檔依 VAD 結果分段，每段不超過 max_duration 秒
    用於並行傳送給 STT API

    Returns:
        分段音檔路徑清單
    """
    audio, sr = sf.read(filepath)
    if audio.ndim > 1:
        audio = audio[:, 0]

    total_duration = len(audio) / sr

    # 短音檔不需要分段
    if total_duration <= max_duration:
        return [filepath]

    segments = detect_voice_segments(filepath)
    if not segments:
        return [filepath]

    # 合併相鄰段落，確保每個 chunk 不超過 max_duration
    chunks = []
    current_start = segments[0][0]
    current_end = segments[0][1]

    for start, end in segments[1:]:
        if end - current_start <= max_duration:
            current_end = end
        else:
            chunks.append((current_start, current_end))
            current_start = start
            current_end = end
    chunks.append((current_start, current_end))

    # 寫出分段音檔
    output_dir = os.path.dirname(filepath) or "."
    base = os.path.splitext(os.path.basename(filepath))[0]
    paths = []

    for i, (start, end) in enumerate(chunks):
        s = int(start * sr)
        e = min(int(end * sr), len(audio))
        chunk_path = os.path.join(output_dir, f"{base}_chunk{i}.wav")
        sf.write(chunk_path, audio[s:e], sr)
        paths.append(chunk_path)
        print(f"[分段] chunk {i}: {start:.1f}s - {end:.1f}s → {chunk_path}")

    return paths

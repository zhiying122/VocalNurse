"""
環境噪音過濾 (Denoising)
使用 Spectral Subtraction 過濾護理車移動聲、儀器嗶嗶聲
"""
import numpy as np
import soundfile as sf


def spectral_subtraction(filepath: str, noise_duration: float = 0.5, alpha: float = 2.0) -> str:
    """
    頻譜減法降噪：取前 noise_duration 秒作為噪音樣本，從全段音訊中減去

    Args:
        filepath: 音檔路徑
        noise_duration: 取前幾秒作為噪音估計
        alpha: 過度減法係數（越大降噪越強，但可能失真）

    Returns:
        降噪後的音檔路徑（覆蓋原檔）
    """
    audio, sr = sf.read(filepath)
    if audio.ndim > 1:
        audio = audio[:, 0]  # 取單聲道

    # 參數
    frame_len = int(0.025 * sr)   # 25ms 窗格
    hop_len = int(0.010 * sr)     # 10ms 步進
    n_fft = frame_len

    # 取噪音樣本（前 noise_duration 秒）
    noise_samples = int(noise_duration * sr)
    noise_segment = audio[:noise_samples]

    # 估計噪音頻譜
    noise_frames = _frame_signal(noise_segment, frame_len, hop_len)
    noise_spec = np.mean(np.abs(np.fft.rfft(noise_frames * np.hanning(frame_len), n=n_fft)), axis=0)

    # 對全段音訊做頻譜減法
    frames = _frame_signal(audio, frame_len, hop_len)
    window = np.hanning(frame_len)
    output = np.zeros(len(audio))
    count = np.zeros(len(audio))

    for i, frame in enumerate(frames):
        spec = np.fft.rfft(frame * window, n=n_fft)
        mag = np.abs(spec)
        phase = np.angle(spec)

        # 減去噪音，設下限避免負值
        clean_mag = np.maximum(mag - alpha * noise_spec, 0.01 * mag)
        clean_spec = clean_mag * np.exp(1j * phase)
        clean_frame = np.fft.irfft(clean_spec, n=n_fft)[:frame_len]

        start = i * hop_len
        end = start + frame_len
        if end > len(output):
            break
        output[start:end] += clean_frame * window
        count[start:end] += window ** 2

    # 正規化
    count = np.maximum(count, 1e-8)
    output = output / count

    # 正規化音量
    max_val = np.max(np.abs(output))
    if max_val > 0:
        output = output / max_val * 0.9

    sf.write(filepath, output.astype(np.float32), sr)
    print(f"[降噪] 頻譜減法完成（alpha={alpha}）")
    return filepath


def _frame_signal(signal: np.ndarray, frame_len: int, hop_len: int) -> np.ndarray:
    """將信號切成重疊窗格"""
    n_frames = 1 + (len(signal) - frame_len) // hop_len
    indices = np.arange(frame_len)[None, :] + np.arange(n_frames)[:, None] * hop_len
    return signal[indices]

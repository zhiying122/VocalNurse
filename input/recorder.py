"""
錄音模組：支援「按下開始、放開結束」與「開關式」兩種模式
錄音完成後自動存檔為 WAV
"""
import sounddevice as sd
import soundfile as sf
import numpy as np
import threading
import time
import os

SAMPLE_RATE = 16000  # Whisper 最佳取樣率
CHANNELS = 1
MAX_DURATION = 300   # 最長 5 分鐘


class AudioRecorder:
    def __init__(self, output_dir: str = "temp_audio"):
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)
        self.is_recording = False
        self._frames: list[np.ndarray] = []
        self._thread = None

    def start(self):
        """開始錄音"""
        self.is_recording = True
        self._frames = []
        self._thread = threading.Thread(target=self._record_loop, daemon=True)
        self._thread.start()
        print("[錄音] 開始錄音...")

    def stop(self) -> str:
        """停止錄音，回傳音檔路徑"""
        self.is_recording = False
        if self._thread:
            self._thread.join(timeout=2)

        if not self._frames:
            print("[錄音] 沒有錄到任何音訊")
            return ""

        audio = np.concatenate(self._frames, axis=0)
        filename = f"recording_{int(time.time())}.wav"
        filepath = os.path.join(self.output_dir, filename)
        sf.write(filepath, audio, SAMPLE_RATE)
        duration = len(audio) / SAMPLE_RATE
        print(f"[錄音] 已儲存：{filepath}（{duration:.1f} 秒）")
        return filepath

    def _record_loop(self):
        """背景錄音迴圈"""
        start_time = time.time()
        with sd.InputStream(samplerate=SAMPLE_RATE, channels=CHANNELS, dtype="float32") as stream:
            while self.is_recording:
                if time.time() - start_time > MAX_DURATION:
                    print(f"[錄音] 已達最長 {MAX_DURATION} 秒，自動停止")
                    self.is_recording = False
                    break
                data, _ = stream.read(SAMPLE_RATE)  # 每次讀 1 秒
                self._frames.append(data.copy())


def record_toggle() -> str:
    """
    開關式錄音：第一次呼叫開始，第二次呼叫停止
    回傳音檔路徑
    """
    recorder = AudioRecorder()
    recorder.start()
    input("按 Enter 停止錄音...")
    return recorder.stop()


if __name__ == "__main__":
    filepath = record_toggle()
    if filepath:
        print(f"音檔位置：{filepath}")

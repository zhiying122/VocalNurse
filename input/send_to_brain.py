"""
接口對接：將清理後的文字以 {"raw_text": "..."} 格式傳送給角色 B
"""
import os
import json
import requests
from dotenv import load_dotenv

load_dotenv()

BRAIN_API_URL = os.getenv("BRAIN_API_URL", "http://localhost:8001/brain/process")


def send_to_brain(raw_text: str) -> dict:
    """
    傳送文字給 Brain Layer (角色 B)

    Args:
        raw_text: 清理後的語音轉錄文字

    Returns:
        Brain Layer 回傳的結構化 JSON（SOAP + 藥物資訊）
    """
    payload = {"raw_text": raw_text}

    try:
        response = requests.post(
            BRAIN_API_URL,
            json=payload,
            timeout=30,
        )
        response.raise_for_status()
        result = response.json()
        print(f"[對接] 成功取得 Brain 回應")
        return result

    except requests.ConnectionError:
        print(f"[對接] 無法連線到 Brain API：{BRAIN_API_URL}")
        print("[對接] 請確認角色 B 的 server 已啟動（uvicorn api:app --port 8001）")
        return {}
    except requests.Timeout:
        print("[對接] Brain API 回應逾時（>30秒）")
        return {}
    except Exception as e:
        print(f"[對接] 錯誤：{e}")
        return {}

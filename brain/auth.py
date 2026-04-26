"""
真實的註冊/登入系統（JSON 檔案儲存，不需要資料庫）
"""
import json
import os
from datetime import datetime, timedelta, timezone
from passlib.context import CryptContext
from jose import jwt

SECRET_KEY = "voicenursy-secret-key-change-in-production"
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 8  # 一個班次

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
USERS_FILE = os.path.join(os.path.dirname(__file__), "users.json")


def _load_users() -> dict:
    if os.path.exists(USERS_FILE):
        with open(USERS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def _save_users(users: dict):
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(users, f, ensure_ascii=False, indent=2)


def register(employee_id: str, password: str, name: str, role: str = "nurse") -> dict:
    users = _load_users()
    if employee_id in users:
        return {"success": False, "message": "此員工編號已註冊"}

    users[employee_id] = {
        "name": name,
        "role": role,
        "password_hash": pwd_context.hash(password),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _save_users(users)
    return {"success": True, "message": "註冊成功"}


def login(employee_id: str, password: str) -> dict:
    users = _load_users()
    user = users.get(employee_id)
    if not user:
        return {"success": False, "message": "員工編號不存在"}
    if not pwd_context.verify(password, user["password_hash"]):
        return {"success": False, "message": "密碼錯誤"}

    token = jwt.encode(
        {
            "sub": employee_id,
            "name": user["name"],
            "role": user["role"],
            "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS),
        },
        SECRET_KEY,
        algorithm=ALGORITHM,
    )
    return {
        "success": True,
        "token": token,
        "user": {"employee_id": employee_id, "name": user["name"], "role": user["role"]},
    }


def verify_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except Exception:
        return None

"""
真實的註冊/登入系統（JSON 檔案儲存）
使用 hashlib 取代 bcrypt，避免 Python 3.14 相容性問題
"""
import json
import os
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from jose import jwt

SECRET_KEY = "voicenursy-secret-key-change-in-production"
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 8

USERS_FILE = os.path.join(os.path.dirname(__file__), "users.json")


def _hash_password(password: str, salt: str = None) -> tuple[str, str]:
    if salt is None:
        salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100000).hex()
    return hashed, salt


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

    hashed, salt = _hash_password(password)
    users[employee_id] = {
        "name": name,
        "role": role,
        "password_hash": hashed,
        "salt": salt,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _save_users(users)
    return {"success": True, "message": "註冊成功"}


def login(employee_id: str, password: str) -> dict:
    users = _load_users()
    user = users.get(employee_id)
    if not user:
        return {"success": False, "message": "員工編號不存在"}

    hashed, _ = _hash_password(password, user["salt"])
    if hashed != user["password_hash"]:
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
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        return None

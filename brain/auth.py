"""
真實的註冊/登入系統（JSON 檔案儲存）
使用 hashlib 取代 bcrypt，避免 Python 3.14 相容性問題

安全措施：
- JWT 密鑰從環境變數讀取（JWT_SECRET_KEY）
- PBKDF2-SHA256 密碼雜湊，600,000 次迭代（OWASP 2024 建議值）
- 登入/註冊事件記錄到 auth_log.json
"""
import json
import os
import hashlib
import secrets
import threading
from datetime import datetime, timedelta, timezone
from jose import jwt
from dotenv import load_dotenv

# 載入 .env 環境變數
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

# ── JWT 密鑰設定 ──
# 優先從環境變數 JWT_SECRET_KEY 讀取
# 若未設定，產生隨機密鑰並印出警告（僅適用於開發環境）
_env_secret = os.getenv("JWT_SECRET_KEY")
if _env_secret:
    SECRET_KEY = _env_secret
else:
    SECRET_KEY = secrets.token_hex(32)
    print("⚠️  警告：未設定 JWT_SECRET_KEY 環境變數，已自動產生隨機密鑰。")
    print("⚠️  每次重啟伺服器後，所有已發行的 JWT token 將失效。")
    print("⚠️  正式環境請在 .env 中設定 JWT_SECRET_KEY。")

ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 8

# PBKDF2 迭代次數：600,000 次
# 根據 OWASP 2024 密碼儲存建議，PBKDF2-SHA256 應使用至少 600,000 次迭代
# 以抵抗現代 GPU 暴力破解攻擊。較高的迭代次數會增加登入延遲（約 0.3-0.5 秒），
# 但對於醫療系統的安全性而言是必要的權衡。
PBKDF2_ITERATIONS = 600000

USERS_FILE = os.path.join(os.path.dirname(__file__), "users.json")
AUTH_LOG_FILE = os.path.join(os.path.dirname(__file__), "auth_log.json")

# 全域鎖：防止並發讀寫 users.json 和 auth_log.json
_users_lock = threading.Lock()
_log_lock = threading.Lock()


def _hash_password(password: str, salt: str = None, iterations: int = PBKDF2_ITERATIONS) -> tuple[str, str]:
    """密碼雜湊：使用 PBKDF2-SHA256 搭配隨機鹽值"""
    if salt is None:
        salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), iterations
    ).hex()
    return hashed, salt


# 舊版迭代次數（用於向下相容，自動遷移舊密碼）
_OLD_ITERATIONS = 100000


def _load_users() -> dict:
    """從 users.json 載入所有使用者資料"""
    if os.path.exists(USERS_FILE):
        with open(USERS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def _save_users(users: dict):
    """將使用者資料寫入 users.json"""
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(users, f, ensure_ascii=False, indent=2)


def _log_auth_event(employee_id: str, event_type: str, success: bool):
    """
    記錄認證事件到 auth_log.json。

    每次登入（成功/失敗）和註冊都會呼叫此函式，
    用於安全稽核和異常登入偵測。

    參數：
        employee_id — 員工編號
        event_type  — 事件類型：'login' 或 'register'
        success     — 是否成功
    """
    # 載入現有日誌
    logs = []
    if os.path.exists(AUTH_LOG_FILE):
        try:
            with open(AUTH_LOG_FILE, "r", encoding="utf-8") as f:
                logs = json.load(f)
        except (json.JSONDecodeError, IOError):
            logs = []

    # 新增事件紀錄
    logs.append({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "employee_id": employee_id,
        "event_type": event_type,
        "success": success,
    })

    # 只保留最近 10000 筆紀錄，避免檔案無限增長
    if len(logs) > 10000:
        logs = logs[-10000:]

    # 寫入檔案
    try:
        with _log_lock:
            with open(AUTH_LOG_FILE, "w", encoding="utf-8") as f:
                json.dump(logs, f, ensure_ascii=False, indent=2)
    except IOError:
        pass  # 日誌寫入失敗不應影響主要功能


def register(employee_id: str, password: str, name: str, role: str = "nurse") -> dict:
    """護理師註冊：建立新帳號"""
    with _users_lock:
        users = _load_users()
        if employee_id in users:
            _log_auth_event(employee_id, "register", False)
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
    _log_auth_event(employee_id, "register", True)
    return {"success": True, "message": "註冊成功"}


def login(employee_id: str, password: str) -> dict:
    """
    護理師登入：驗證帳密，回傳 JWT token。

    密碼遷移機制：
        如果用新的迭代次數（600,000）驗證失敗，會嘗試用舊的迭代次數（100,000）。
        若舊的成功，表示這是升級前建立的帳號，會自動用新的迭代次數重新雜湊密碼並更新。
        這樣舊帳號不會因為升級雜湊強度而被鎖死。
    """
    with _users_lock:
        users = _load_users()
        user = users.get(employee_id)
        if not user:
            _log_auth_event(employee_id, "login", False)
            return {"success": False, "message": "員工編號不存在"}

        # 先用新的迭代次數驗證
        hashed, _ = _hash_password(password, user["salt"])
        if hashed != user["password_hash"]:
            # 新的不對，嘗試用舊的迭代次數（向下相容）
            old_hashed, _ = _hash_password(password, user["salt"], iterations=_OLD_ITERATIONS)
            if old_hashed == user["password_hash"]:
                # 舊密碼驗證成功 → 自動遷移到新的迭代次數
                new_hashed, new_salt = _hash_password(password)
                users[employee_id]["password_hash"] = new_hashed
                users[employee_id]["salt"] = new_salt
                _save_users(users)
                print(f"[Auth] 已自動遷移 {employee_id} 的密碼雜湊到新的迭代次數")
            else:
                # 新舊都不對，密碼真的錯了
                _log_auth_event(employee_id, "login", False)
                return {"success": False, "message": "密碼錯誤"}

        user_info = {"name": user["name"], "role": user["role"]}

    token = jwt.encode(
        {
            "sub": employee_id,
            "name": user_info["name"],
            "role": user_info["role"],
            "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS),
        },
        SECRET_KEY,
        algorithm=ALGORITHM,
    )
    _log_auth_event(employee_id, "login", True)
    return {
        "success": True,
        "token": token,
        "user": {"employee_id": employee_id, "name": user_info["name"], "role": user_info["role"]},
    }


def verify_token(token: str) -> dict | None:
    """驗證 JWT token 的有效性"""
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        return None

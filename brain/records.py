"""
SOAP 護理紀錄管理模組（JSON 檔案儲存）

本模組負責 SOAP 護理紀錄的持久化操作，包含：
- 新增紀錄（add_record）
- 查詢特定病患的所有紀錄（get_patient_records）
- 查詢所有紀錄，支援日期篩選（list_records）

儲存方式：
- 使用 JSON 檔案（records.json）儲存所有紀錄
- 與 patients.py 的儲存模式一致（單一 JSON 檔案 + _load/_save 輔助函式）
- 檔案不存在時會自動建立

紀錄 ID 格式：R + 6 位大寫十六進位字元（例如 R3A5B2C）
時間戳記：ISO 8601 格式，UTC 時區

此模組是「共享護理紀錄」功能的核心，讓不同護理師可以共享同一病患的 SOAP 紀錄，
解決原本紀錄只存在瀏覽器記憶體、無法跨裝置/跨班別共享的問題。
"""
import json
import os
import uuid
from datetime import datetime, timezone

# 引入病患模組，用於驗證病患 ID 是否存在
import patients as _patients_mod

# records.json 的檔案路徑，與本模組同目錄
RECORDS_FILE = os.path.join(os.path.dirname(__file__), "records.json")


def _load() -> list[dict]:
    """
    從 records.json 載入所有紀錄。

    回傳值：
        list[dict] — 紀錄列表，每筆紀錄為一個 dict
                     若檔案不存在，回傳空列表（不會報錯）
    """
    if os.path.exists(RECORDS_FILE):
        with open(RECORDS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def _save(records: list[dict]):
    """
    將紀錄列表寫入 records.json。

    參數：
        records — 完整的紀錄列表（會覆蓋整個檔案）

    注意：
        - 使用 ensure_ascii=False 以正確儲存中文字元
        - 使用 indent=2 讓 JSON 檔案易於閱讀
        - 若檔案不存在會自動建立
    """
    with open(RECORDS_FILE, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)


def add_record(
    patient_id: str,
    soap: dict,
    medications: list[dict],
    pain_scale: int | None,
    warnings: list[str],
    raw_text: str,
    nurse_id: str,
    nurse_name: str,
    shift: str,
) -> dict:
    """
    新增一筆 SOAP 護理紀錄。

    參數：
        patient_id  — 病患 ID（例如 "P8EE7C3"），必須是已存在的病患
        soap        — SOAP 內容 dict，包含 subjective/objective/assessment/plan 四個欄位
        medications — 藥物列表，每筆包含 name/dose/unit/route/raw
        pain_scale  — 疼痛指數 0-10，沒有則為 None
        warnings    — AI 偵測到的潛在問題列表
        raw_text    — 原始語音辨識文字（供除錯用）
        nurse_id    — 建立此紀錄的護理師員工編號（從 JWT token 取得）
        nurse_name  — 建立此紀錄的護理師姓名（從 JWT token 取得）
        shift       — 班別標籤：「日班」「小夜班」「大夜班」

    回傳值：
        dict — 完整的紀錄（含系統產生的 id 和 created_at）

    例外：
        ValueError — 當 patient_id 不存在於病患資料庫時拋出

    重複檢查：
        若同一護理師在同一時間戳記對同一病患已有紀錄，
        會直接回傳既有紀錄而不重複建立（防止離線同步時重複寫入）
    """
    # ── 步驟 1：驗證病患是否存在 ──
    patients = _patients_mod.list_patients()
    if not any(p["id"] == patient_id for p in patients):
        raise ValueError(f"病患不存在: {patient_id}")

    # ── 步驟 2：產生建立時間戳記（UTC） ──
    created_at = datetime.now(timezone.utc).isoformat()

    # ── 步驟 3：重複紀錄檢查 ──
    # 以 patient_id + created_at + nurse_id 三個欄位組合判斷是否重複
    # 這是為了防止離線同步時，同一筆紀錄被重複上傳
    records = _load()
    for r in records:
        if (
            r["patient_id"] == patient_id
            and r["created_at"] == created_at
            and r["nurse_id"] == nurse_id
        ):
            # 已存在相同紀錄，直接回傳（不重複建立）
            return r

    # ── 步驟 4：組裝新紀錄 ──
    record = {
        "id": f"R{uuid.uuid4().hex[:6].upper()}",  # 產生唯一 ID，格式：R + 6 位 hex
        "patient_id": patient_id,
        "soap": soap,
        "medications": medications,
        "pain_scale": pain_scale,
        "warnings": warnings,
        "raw_text": raw_text,
        "nurse_id": nurse_id,       # 記錄是哪位護理師建立的（用於交班顯示）
        "nurse_name": nurse_name,   # 護理師姓名（直接顯示在前端，不需再查詢）
        "shift": shift,             # 班別（日班/小夜班/大夜班）
        "created_at": created_at,   # 建立時間（ISO 8601 UTC）
    }

    # ── 步驟 5：寫入檔案 ──
    records.append(record)
    _save(records)
    return record


def get_patient_records(patient_id: str) -> list[dict]:
    """
    查詢指定病患的所有 SOAP 紀錄。

    參數：
        patient_id — 病患 ID

    回傳值：
        list[dict] — 該病患的所有紀錄，按 created_at 降序排列（最新的在前面）
                     包含所有護理師建立的紀錄（不限於查詢者本人）
                     若該病患沒有任何紀錄，回傳空列表

    例外：
        ValueError — 當 patient_id 不存在於病患資料庫時拋出

    用途：
        前端 selectPatient() 呼叫此函式，載入病患的完整護理歷程
    """
    # 驗證病患是否存在
    patients = _patients_mod.list_patients()
    if not any(p["id"] == patient_id for p in patients):
        raise ValueError(f"病患不存在: {patient_id}")

    # 從所有紀錄中篩選出該病患的紀錄
    records = _load()
    filtered = [r for r in records if r["patient_id"] == patient_id]

    # 按建立時間降序排列（最新的在最前面，方便前端顯示）
    filtered.sort(key=lambda r: r["created_at"], reverse=True)
    return filtered


def list_records(date_filter: str | None = None) -> list[dict]:
    """
    查詢所有紀錄，可選擇以日期篩選。

    參數：
        date_filter — 日期字串，格式 YYYY-MM-DD（例如 "2025-01-15"）
                      若為 None 則回傳所有紀錄

    回傳值：
        list[dict] — 符合條件的紀錄列表
                     包含所有護理師、所有病患的紀錄

    用途：
        前端交班報告頁面（renderHandover）呼叫此函式，
        一次取得所有病患的紀錄摘要，供班別交接使用
    """
    records = _load()

    # 若有指定日期篩選，只回傳該日期的紀錄
    # 比對方式：取 created_at 的前 10 個字元（即 YYYY-MM-DD 部分）
    if date_filter is not None:
        records = [r for r in records if r["created_at"][:10] == date_filter]

    return records

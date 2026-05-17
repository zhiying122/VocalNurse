"""
SOAP 護理紀錄管理模組（JSON 檔案儲存）

本模組負責 SOAP 護理紀錄的持久化操作，包含：
- 新增紀錄（add_record）
- 查詢特定病患的所有紀錄（get_patient_records）
- 查詢所有紀錄，支援日期篩選與分頁（list_records）
- 更新紀錄（update_record）

儲存方式：
- 使用 JSON 檔案（records.json）儲存所有紀錄
- 紀錄 ID 格式：R + 6 位大寫十六進位字元（例如 R3A5B2C）
- 時間戳記：ISO 8601 格式，UTC 時區
- 使用 threading.Lock 防止並發寫入造成資料遺失
"""
import json
import math
import os
import threading
import uuid
from datetime import datetime, timezone

import patients as _patients_mod

RECORDS_FILE = os.path.join(os.path.dirname(__file__), "records.json")

# 全域寫入鎖：防止多個請求同時寫入 records.json 造成資料遺失
_write_lock = threading.Lock()


def _load() -> list[dict]:
    """從 records.json 載入所有紀錄"""
    if os.path.exists(RECORDS_FILE):
        with open(RECORDS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def _save(records: list[dict]):
    """將紀錄列表寫入 records.json"""
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
    alerts: list[dict] | None = None,
) -> dict:
    """
    新增一筆 SOAP 護理紀錄。

    參數：
        patient_id  — 病患 ID（必須是已存在的病患）
        soap        — SOAP 內容 dict
        medications — 藥物列表
        pain_scale  — 疼痛指數 0-10
        warnings    — AI 偵測到的潛在問題列表
        raw_text    — 原始語音辨識文字
        nurse_id    — 建立此紀錄的護理師員工編號
        nurse_name  — 建立此紀錄的護理師姓名
        shift       — 班別標籤
        alerts      — 【新增】安全警示列表（每筆包含 type/severity/item/detected/range/message）

    回傳值：
        dict — 完整的紀錄（含系統產生的 id 和 created_at）

    例外：
        ValueError — 當 patient_id 不存在時拋出
    """
    # ── 步驟 1：驗證病患是否存在 ──
    patients = _patients_mod.list_patients()
    if not any(p["id"] == patient_id for p in patients):
        raise ValueError(f"病患不存在: {patient_id}")

    # ── 步驟 2：產生建立時間戳記（UTC） ──
    created_at = datetime.now(timezone.utc).isoformat()

    with _write_lock:
        # ── 步驟 3：重複紀錄檢查 ──
        records = _load()
        for r in records:
            if (
                r["patient_id"] == patient_id
                and r["created_at"] == created_at
                and r["nurse_id"] == nurse_id
            ):
                return r

        # ── 步驟 4：組裝新紀錄 ──
        record = {
            "id": f"R{uuid.uuid4().hex[:6].upper()}",
            "patient_id": patient_id,
            "soap": soap,
            "medications": medications,
            "pain_scale": pain_scale,
            "warnings": warnings,
            "raw_text": raw_text,
            "nurse_id": nurse_id,
            "nurse_name": nurse_name,
            "shift": shift,
            "created_at": created_at,
            "alerts": alerts if alerts is not None else [],
        }

        # ── 步驟 5：寫入檔案 ──
        records.append(record)
        _save(records)
        return record


def get_patient_records(patient_id: str) -> list[dict]:
    """
    查詢指定病患的所有 SOAP 紀錄。

    回傳值：
        list[dict] — 按 created_at 降序排列（最新的在前面）
    """
    patients = _patients_mod.list_patients()
    if not any(p["id"] == patient_id for p in patients):
        raise ValueError(f"病患不存在: {patient_id}")

    records = _load()
    filtered = [r for r in records if r["patient_id"] == patient_id]
    filtered.sort(key=lambda r: r["created_at"], reverse=True)
    return filtered


def list_records(
    date_filter: str | None = None,
    page: int = 1,
    page_size: int = 50,
) -> dict:
    """
    查詢所有紀錄，支援日期篩選與分頁。

    參數：
        date_filter — 日期字串 YYYY-MM-DD（None 則回傳全部）
        page        — 頁碼，從 1 開始（預設 1）
        page_size   — 每頁筆數（預設 50）

    回傳值：
        dict — 包含 records、total、page、page_size、total_pages
    """
    records = _load()

    # 日期篩選
    if date_filter is not None:
        records = [r for r in records if r["created_at"][:10] == date_filter]

    # 按 created_at 降序排序（最新的在前面）
    records.sort(key=lambda r: r.get("created_at", ""), reverse=True)

    total = len(records)
    total_pages = max(1, math.ceil(total / page_size))

    # 分頁切片
    start = (page - 1) * page_size
    end = start + page_size
    paged_records = records[start:end]

    return {
        "records": paged_records,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


def update_record(record_id: str, updates: dict) -> dict | None:
    """
    更新指定紀錄的部分欄位。

    僅允許更新以下欄位：soap、medications、pain_scale、warnings。
    其他欄位（id、patient_id、nurse_id 等）不可修改。

    參數：
        record_id — 紀錄 ID（例如 "R3A5B2C"）
        updates   — 要更新的欄位 dict

    回傳值：
        dict — 更新後的完整紀錄
        None — 紀錄不存在
    """
    # 僅允許更新的欄位白名單
    ALLOWED_FIELDS = {"soap", "medications", "pain_scale", "warnings"}

    with _write_lock:
        records = _load()

        for i, r in enumerate(records):
            if r["id"] == record_id:
                # 只更新允許的欄位
                for key, value in updates.items():
                    if key in ALLOWED_FIELDS and value is not None:
                        # 如果是 Pydantic model，轉為 dict
                        if hasattr(value, "model_dump"):
                            records[i][key] = value.model_dump()
                        elif isinstance(value, list):
                            records[i][key] = [
                                item.model_dump() if hasattr(item, "model_dump") else item
                                for item in value
                            ]
                        else:
                            records[i][key] = value

                _save(records)
                return records[i]

    return None


def delete_record(record_id: str, nurse_id: str) -> bool:
    """
    刪除指定紀錄。只有建立者才能刪除。
    回傳 True 表示成功，False 表示找不到或無權限。
    """
    with _write_lock:
        records = _load()
        for i, r in enumerate(records):
            if r["id"] == record_id:
                if r.get("nurse_id") != nurse_id:
                    raise PermissionError("無權限刪除他人建立的紀錄")
                records.pop(i)
                _save(records)
                return True
    return False

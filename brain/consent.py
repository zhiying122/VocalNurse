"""
VoiceNursy IRB 知情同意服務模組（Informed Consent Service）

本模組負責所有知情同意的業務邏輯，包含：
- 同意紀錄的 CRUD（僅 Create 和 Read，不允許 Update/Delete）
- 同意狀態查詢（含版本比對）
- 護理紀錄建立前的同意驗證
- 稽核日誌寫入
- 同意書設定載入與格式化

資料持久化：
    consents.json       — 同意紀錄（Append-Only）
    consent_audit.json  — 稽核日誌
    consent_config.json — 同意書設定
"""

import json
import os
import threading
import logging
import secrets
from datetime import datetime

from schemas import (
    ConsentStatus,
    ConsentRecord,
    ConsentStatusResponse,
    ConsentSummary,
    ConsentAuditEntry,
    ConsentConfig,
    ConsentSection,
)

# ══════════════════════════════════════════════════════════
# 路徑常數
# ══════════════════════════════════════════════════════════

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CONSENTS_FILE = os.path.join(BASE_DIR, "consents.json")
CONSENT_AUDIT_FILE = os.path.join(BASE_DIR, "consent_audit.json")
CONSENT_CONFIG_FILE = os.path.join(BASE_DIR, "consent_config.json")

# ══════════════════════════════════════════════════════════
# 執行緒鎖
# ══════════════════════════════════════════════════════════

_consents_lock = threading.Lock()
_audit_lock = threading.Lock()

# ══════════════════════════════════════════════════════════
# 例外類別
# ══════════════════════════════════════════════════════════


class ConsentRequired(Exception):
    """病患尚未同意（pending / declined / withdrawn）"""

    def __init__(self, status: str):
        self.status = status
        super().__init__(f"病患同意狀態不符合要求：{status}")


class ConsentVersionMismatch(Exception):
    """病患同意的版本與目前系統版本不符"""

    def __init__(self, patient_version: str, current_version: str):
        self.patient_version = patient_version
        self.current_version = current_version
        super().__init__(
            f"同意書版本不符：病患版本 {patient_version}，目前版本 {current_version}"
        )


# ══════════════════════════════════════════════════════════
# 檔案 I/O 基礎設施
# ══════════════════════════════════════════════════════════


def _load_consents() -> list[dict]:
    """
    讀取 consents.json。
    若檔案不存在則自動建立空陣列並回傳 []，不拋出例外。
    若 JSON 解析失敗，記錄 logging.error 並回傳 []。
    讀寫皆使用 _consents_lock 保護。
    """
    with _consents_lock:
        if not os.path.exists(CONSENTS_FILE):
            try:
                with open(CONSENTS_FILE, "w", encoding="utf-8") as f:
                    json.dump([], f, ensure_ascii=False, indent=2)
            except OSError as e:
                logging.error("建立 consents.json 失敗：%s", e)
            return []
        try:
            with open(CONSENTS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError as e:
            logging.error("解析 consents.json 失敗：%s", e)
            return []
        except OSError as e:
            logging.error("讀取 consents.json 失敗：%s", e)
            return []


def _save_consents(data: list[dict]) -> None:
    """
    使用 _consents_lock 將資料寫入 consents.json。
    使用 ensure_ascii=False 與 indent=2 格式化輸出。
    """
    with _consents_lock:
        try:
            with open(CONSENTS_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except OSError as e:
            logging.error("寫入 consents.json 失敗：%s", e)


def _load_audit() -> list[dict]:
    """
    讀取 consent_audit.json。
    若檔案不存在則自動建立空陣列並回傳 []，不拋出例外。
    若 JSON 解析失敗，記錄 logging.error 並回傳 []。
    讀寫皆使用 _audit_lock 保護。
    """
    with _audit_lock:
        if not os.path.exists(CONSENT_AUDIT_FILE):
            try:
                with open(CONSENT_AUDIT_FILE, "w", encoding="utf-8") as f:
                    json.dump([], f, ensure_ascii=False, indent=2)
            except OSError as e:
                logging.error("建立 consent_audit.json 失敗：%s", e)
            return []
        try:
            with open(CONSENT_AUDIT_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError as e:
            logging.error("解析 consent_audit.json 失敗：%s", e)
            return []
        except OSError as e:
            logging.error("讀取 consent_audit.json 失敗：%s", e)
            return []


def _save_audit(data: list[dict]) -> None:
    """
    使用 _audit_lock 將資料寫入 consent_audit.json。
    使用 ensure_ascii=False 與 indent=2 格式化輸出。
    """
    with _audit_lock:
        try:
            with open(CONSENT_AUDIT_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except OSError as e:
            logging.error("寫入 consent_audit.json 失敗：%s", e)


# ══════════════════════════════════════════════════════════
# 同意書設定載入與格式化
# ══════════════════════════════════════════════════════════

DEFAULT_CONSENT_CONFIG = ConsentConfig(
    version="v1.0",
    effective_date="2025-01-01",
    title="VoiceNursy 護理語音紀錄系統知情同意書",
    sections=[
        ConsentSection(id="purpose", heading="研究目的", content="本系統旨在透過語音辨識技術協助護理師建立 SOAP 護理紀錄，提升護理記錄效率與品質。"),
        ConsentSection(id="data_types", heading="收集的資料類型", content="本系統將收集您的語音錄音及由語音轉換而成的護理紀錄文字，包含主訴、生命徵象、護理評估與計畫。"),
        ConsentSection(id="data_storage", heading="資料保存方式", content="所有資料僅儲存於院內伺服器，不會傳輸至院外。資料保存期限依醫院規定辦理。"),
        ConsentSection(id="withdrawal_rights", heading="撤回同意權利", content="您有權隨時撤回同意，撤回後系統將停止收集新資料，但已建立的護理紀錄依法規仍須保存。"),
        ConsentSection(id="contact", heading="聯絡窗口", content="如有疑問，請聯絡本院 IRB 辦公室，電話：(02) XXXX-XXXX，電子郵件：irb@hospital.org.tw"),
    ]
)


def validate_consent_config(config: dict) -> bool:
    """
    驗證同意書設定格式的完整性。

    必要欄位：version、title、sections。
    sections 必須是非空的 list，且每個 section 必須包含 id、heading、content 欄位。

    Args:
        config: 從 JSON 載入的設定字典

    Returns:
        True 若所有驗證通過，否則 False
    """
    # 驗證頂層必要欄位
    for field in ("version", "title", "sections"):
        if field not in config:
            return False

    # sections 必須是非空的 list
    sections = config["sections"]
    if not isinstance(sections, list) or len(sections) == 0:
        return False

    # 每個 section 必須包含 id、heading、content
    for section in sections:
        if not isinstance(section, dict):
            return False
        for field in ("id", "heading", "content"):
            if field not in section:
                return False

    return True


def load_consent_config() -> ConsentConfig:
    """
    從 consent_config.json 載入同意書設定。

    若設定檔不存在、讀取失敗或格式驗證不通過，
    記錄 logging.warning 並回傳內建預設值 DEFAULT_CONSENT_CONFIG。

    Returns:
        ConsentConfig 物件（來自設定檔或預設值）
    """
    try:
        with open(CONSENT_CONFIG_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except FileNotFoundError:
        logging.warning("consent_config.json 不存在，使用內建預設同意書設定")
        return DEFAULT_CONSENT_CONFIG
    except (json.JSONDecodeError, OSError) as e:
        logging.warning("讀取 consent_config.json 失敗：%s，使用內建預設同意書設定", e)
        return DEFAULT_CONSENT_CONFIG

    if not validate_consent_config(raw):
        logging.warning("consent_config.json 格式驗證失敗，使用內建預設同意書設定")
        return DEFAULT_CONSENT_CONFIG

    return ConsentConfig(
        version=raw["version"],
        effective_date=raw.get("effective_date", ""),
        title=raw["title"],
        sections=[
            ConsentSection(
                id=s["id"],
                heading=s["heading"],
                content=s["content"],
            )
            for s in raw["sections"]
        ],
    )


def format_consent_to_html(config: ConsentConfig) -> str:
    """
    將 ConsentConfig 物件格式化為 HTML 字串。

    輸出格式：
        <article class="consent-form">
          <h1>{title}</h1>
          <p class="consent-version">版本：{version}（生效日期：{effective_date}）</p>
          <section id="{section.id}">
            <h2>{section.heading}</h2>
            <p>{section.content}</p>
          </section>
          ...
        </article>

    Args:
        config: ConsentConfig 物件

    Returns:
        格式化後的 HTML 字串
    """
    sections_html = ""
    for section in config.sections:
        sections_html += (
            f'  <section id="{section.id}">\n'
            f"    <h2>{section.heading}</h2>\n"
            f"    <p>{section.content}</p>\n"
            f"  </section>\n"
        )

    return (
        '<article class="consent-form">\n'
        f"  <h1>{config.title}</h1>\n"
        f'  <p class="consent-version">版本：{config.version}（生效日期：{config.effective_date}）</p>\n'
        f"{sections_html}"
        "</article>"
    )

# ══════════════════════════════════════════════════════════
# 同意狀態查詢
# ══════════════════════════════════════════════════════════


def get_consent_status(patient_id: str) -> ConsentStatusResponse:
    """
    查詢指定病患的最新知情同意狀態。

    若病患無任何同意紀錄，回傳 pending 狀態及目前同意書版本號。
    若有紀錄，取最新一筆（依 created_at 排序），比對版本號後回傳完整狀態。

    對應需求：4.1、4.3、8.4

    Args:
        patient_id: 病患 ID

    Returns:
        ConsentStatusResponse，包含同意狀態、版本號、版本比對結果、
        最後更新時間及操作護理師員工編號
    """
    all_consents = _load_consents()

    # 篩選出此病患的所有紀錄
    patient_consents = [c for c in all_consents if c.get("patient_id") == patient_id]

    if not patient_consents:
        # 無任何紀錄：回傳 pending 狀態，使用目前版本號
        config = load_consent_config()
        return ConsentStatusResponse(
            patient_id=patient_id,
            status=ConsentStatus.pending,
            consent_version=config.version,
            version_match=True,
            last_updated=None,
            nurse_id=None,
        )

    # 有紀錄：取最新一筆（依 created_at 排序，取最後一筆）
    sorted_consents = sorted(patient_consents, key=lambda c: c.get("created_at", ""))
    latest = sorted_consents[-1]

    config = load_consent_config()
    version_match = latest.get("consent_version") == config.version

    return ConsentStatusResponse(
        patient_id=patient_id,
        status=ConsentStatus(latest["status"]),
        consent_version=latest.get("consent_version", config.version),
        version_match=version_match,
        last_updated=latest.get("created_at"),
        nurse_id=latest.get("nurse_id"),
    )


# ══════════════════════════════════════════════════════════
# 稽核日誌
# ══════════════════════════════════════════════════════════


def log_audit_event(
    event_type: str,
    patient_id: str,
    nurse_id: str,
    consent_version: str,
    notes: str = "",
) -> None:
    """
    將知情同意相關事件寫入稽核日誌（consent_audit.json）。

    支援的事件類型：
        consent_shown      — 同意書顯示
        consented          — 病患同意
        declined           — 病患拒絕
        withdrawn          — 同意撤回
        validation_failed  — 同意驗證失敗（含被阻擋的紀錄建立嘗試）

    若任何步驟失敗，記錄 logging.error 但不拋出例外，確保主流程不中斷。

    對應需求：9.1、9.2、9.4

    Args:
        event_type:      事件類型字串
        patient_id:      病患 ID
        nurse_id:        操作護理師員工編號
        consent_version: 同意書版本號
        notes:           備註（可選，預設空字串）
    """
    try:
        audit_id = "A" + secrets.token_hex(3).upper()
        timestamp = datetime.utcnow().isoformat() + "Z"

        entry = ConsentAuditEntry(
            id=audit_id,
            event_type=event_type,
            patient_id=patient_id,
            nurse_id=nurse_id,
            consent_version=consent_version,
            timestamp=timestamp,
            notes=notes,
        )

        audit_log = _load_audit()
        audit_log.append(entry.model_dump())
        _save_audit(audit_log)

    except Exception as e:
        logging.error("寫入稽核日誌失敗：%s", e)


# ══════════════════════════════════════════════════════════
# 同意紀錄建立
# ══════════════════════════════════════════════════════════


def create_consent_record(
    patient_id: str,
    nurse_id: str,
    status: ConsentStatus,
    notes: str = "",
) -> ConsentRecord:
    """
    建立一筆新的知情同意紀錄，並以 Append-Only 方式持久化至 consents.json。

    流程：
    1. 產生唯一 ID（C + 6 位大寫 hex）
    2. 記錄建立時間（ISO 8601 UTC）
    3. 取得目前同意書版本號
    4. 建立 ConsentRecord 物件
    5. 在 _consents_lock 保護下，直接讀取、append、寫入檔案（確保原子性）
    6. 寫入稽核日誌
    7. 回傳 ConsentRecord 物件

    對應需求：2.2、2.6、3.1、3.2、3.3、3.5

    Args:
        patient_id: 病患 ID
        nurse_id:   操作護理師員工編號
        status:     同意狀態（consented / declined / withdrawn）
        notes:      備註（可選，預設空字串）

    Returns:
        建立完成的 ConsentRecord 物件
    """
    # 產生唯一 ID 與時間戳記
    record_id = "C" + secrets.token_hex(3).upper()
    created_at = datetime.utcnow().isoformat() + "Z"

    # 取得目前同意書版本號
    consent_version = load_consent_config().version

    # 建立 ConsentRecord 物件
    record = ConsentRecord(
        id=record_id,
        patient_id=patient_id,
        nurse_id=nurse_id,
        consent_version=consent_version,
        status=status,
        created_at=created_at,
        notes=notes,
    )

    # 使用 _consents_lock 包住整個 load-append-save 操作，確保原子性
    # 直接操作檔案，不呼叫 _load_consents()/_save_consents()（避免 lock 重入）
    with _consents_lock:
        # 讀取現有紀錄
        if not os.path.exists(CONSENTS_FILE):
            try:
                with open(CONSENTS_FILE, "w", encoding="utf-8") as f:
                    json.dump([], f, ensure_ascii=False, indent=2)
            except OSError as e:
                logging.error("建立 consents.json 失敗：%s", e)
            existing = []
        else:
            try:
                with open(CONSENTS_FILE, "r", encoding="utf-8") as f:
                    existing = json.load(f)
            except json.JSONDecodeError as e:
                logging.error("解析 consents.json 失敗：%s", e)
                existing = []
            except OSError as e:
                logging.error("讀取 consents.json 失敗：%s", e)
                existing = []

        # Append 新紀錄（不覆蓋歷史紀錄）
        existing.append(record.model_dump())

        # 寫入檔案
        try:
            with open(CONSENTS_FILE, "w", encoding="utf-8") as f:
                json.dump(existing, f, ensure_ascii=False, indent=2)
        except OSError as e:
            logging.error("寫入 consents.json 失敗：%s", e)

    # 寫入稽核日誌（event_type 對應 status.value）
    log_audit_event(
        event_type=status.value,
        patient_id=patient_id,
        nurse_id=nurse_id,
        consent_version=consent_version,
        notes=notes,
    )

    return record


# ══════════════════════════════════════════════════════════
# 護理紀錄建立前的同意驗證
# ══════════════════════════════════════════════════════════


def verify_consent_for_record(patient_id: str) -> str:
    """
    在建立護理紀錄前，驗證指定病患的知情同意狀態。

    驗證流程：
    1. 呼叫 get_consent_status(patient_id) 取得最新同意狀態
    2. 若 status != ConsentStatus.consented，拋出 ConsentRequired(status.value)
    3. 若 version_match == False，拋出 ConsentVersionMismatch(patient_version, current_version)
    4. 驗證通過：從 consents.json 取得最新一筆 consented 紀錄，回傳其 id

    對應需求：5.1、5.2、5.3

    Args:
        patient_id: 病患 ID

    Returns:
        最新一筆 consented 紀錄的 id（consent_id）

    Raises:
        ConsentRequired:        病患同意狀態不是 consented
        ConsentVersionMismatch: 病患同意書版本與目前系統版本不符
    """
    # 取得最新同意狀態（含版本比對結果）
    consent_status = get_consent_status(patient_id)

    # 驗證同意狀態
    if consent_status.status != ConsentStatus.consented:
        raise ConsentRequired(consent_status.status.value)

    # 驗證版本是否相符
    if not consent_status.version_match:
        current_config = load_consent_config()
        raise ConsentVersionMismatch(
            consent_status.consent_version,
            current_config.version,
        )

    # 驗證通過：從所有紀錄中找出此病患最新一筆 consented 紀錄，回傳其 id
    all_consents = _load_consents()
    patient_consented = [
        c for c in all_consents
        if c.get("patient_id") == patient_id and c.get("status") == "consented"
    ]

    # 依 created_at 排序，取最新一筆
    patient_consented.sort(key=lambda c: c.get("created_at", ""))
    latest_consented = patient_consented[-1]

    return latest_consented["id"]


# ══════════════════════════════════════════════════════════
# 批次查詢與稽核日誌查詢
# ══════════════════════════════════════════════════════════


def get_all_patients_consent_status() -> list[ConsentSummary]:
    """
    批次查詢所有病患的知情同意狀態摘要。

    從 patients.json 讀取所有病患 ID，對每個病患呼叫
    get_consent_status() 取得狀態，並組裝為 ConsentSummary 列表。

    若讀取 patients.json 失敗，記錄 logging.error 並回傳空列表。

    對應需求：4.6

    Returns:
        list[ConsentSummary]，每個元素包含 patient_id、status、
        consent_version（若有）、last_updated（若有）
    """
    patients_file = os.path.join(BASE_DIR, "patients.json")
    try:
        with open(patients_file, "r", encoding="utf-8") as f:
            patients = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        logging.error("讀取 patients.json 失敗：%s", e)
        return []

    result: list[ConsentSummary] = []
    for patient in patients:
        patient_id = patient.get("id")
        if not patient_id:
            continue
        status_response = get_consent_status(patient_id)
        result.append(
            ConsentSummary(
                patient_id=patient_id,
                status=status_response.status,
                consent_version=status_response.consent_version if status_response.last_updated else None,
                last_updated=status_response.last_updated,
            )
        )
    return result


def get_audit_log(
    patient_id: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> list[ConsentAuditEntry]:
    """
    查詢稽核日誌，支援依病患 ID 或日期範圍篩選。

    篩選邏輯（各條件獨立套用，可組合使用）：
    - 若 patient_id 不為 None，篩選 patient_id 相符的條目
    - 若 date_from 不為 None，篩選 timestamp >= date_from（ISO 8601 字串比較）
    - 若 date_to 不為 None，篩選 timestamp <= date_to（ISO 8601 字串比較）

    對應需求：9.3

    Args:
        patient_id: 病患 ID（可選，None 表示不篩選）
        date_from:  起始日期時間（可選，ISO 8601 格式，None 表示不篩選）
        date_to:    結束日期時間（可選，ISO 8601 格式，None 表示不篩選）

    Returns:
        符合篩選條件的 list[ConsentAuditEntry]
    """
    entries = _load_audit()

    if patient_id is not None:
        entries = [e for e in entries if e.get("patient_id") == patient_id]

    if date_from is not None:
        entries = [e for e in entries if e.get("timestamp", "") >= date_from]

    if date_to is not None:
        entries = [e for e in entries if e.get("timestamp", "") <= date_to]

    return [ConsentAuditEntry(**e) for e in entries]

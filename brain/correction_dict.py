"""
醫療術語校正字典
處理 STT 常見錯誤：台語音譯、英文諧音、口語縮寫
"""

# 藥物名稱標準化（口語/錯誤辨識 → 標準名稱）
DRUG_CORRECTION: dict[str, str] = {
    # 普拿疼系列
    "普拿疼": "Acetaminophen",
    "panadol": "Acetaminophen",
    "acetaminophen": "Acetaminophen",
    "撲熱息痛": "Acetaminophen",

    # 止痛消炎
    "沃恩": "Voltaren",
    "voren": "Voltaren",
    "voltaren": "Voltaren",
    "diclofenac": "Diclofenac",
    "阿斯匹靈": "Aspirin",
    "aspirin": "Aspirin",

    # 抗生素
    "安比西林": "Ampicillin",
    "ampicillin": "Ampicillin",
    "阿莫西林": "Amoxicillin",
    "amoxicillin": "Amoxicillin",

    # 心血管
    "脈優": "Amlodipine",
    "amlodipine": "Amlodipine",
    "冠達悅": "Nifedipine",
    "nifedipine": "Nifedipine",

    # 胃藥
    "耐適恩": "Nexium",
    "nexium": "Nexium",
    "esomeprazole": "Esomeprazole",

    # 利尿劑
    "服樂泄": "Furosemide",
    "furosemide": "Furosemide",
    "lasix": "Furosemide",
}

# 醫學縮寫標準化（確保大小寫一致）
ABBREVIATION_CORRECTION: dict[str, str] = {
    "prn": "PRN",
    "qd": "QD",
    "bid": "BID",
    "tid": "TID",
    "qid": "QID",
    "po": "PO",
    "iv": "IV",
    "im": "IM",
    "sc": "SC",
    "bp": "BP",
    "hr": "HR",
    "rr": "RR",
    "spo2": "SpO2",
    "spo₂": "SpO2",
    "bt": "BT",
    "gcs": "GCS",
    "npo": "NPO",
    "sos": "SOS",
}


def normalize_drug_name(text: str) -> str:
    """將文字中的口語藥名替換為標準名稱（不區分大小寫）"""
    lower = text.lower()
    for key, standard in DRUG_CORRECTION.items():
        if key.lower() in lower:
            text = text.replace(key, standard)
            text = text.replace(key.lower(), standard)
            text = text.replace(key.upper(), standard)
    return text


def normalize_abbreviations(text: str) -> str:
    """統一醫學縮寫大小寫"""
    import re
    for key, standard in ABBREVIATION_CORRECTION.items():
        text = re.sub(rf'\b{re.escape(key)}\b', standard, text, flags=re.IGNORECASE)
    return text


def preprocess(text: str) -> str:
    """完整前處理：藥名標準化 + 縮寫統一"""
    text = normalize_drug_name(text)
    text = normalize_abbreviations(text)
    return text

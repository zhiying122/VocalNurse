"""
文字清理：移除冗餘符號、統一藥物名稱
"""
import re

# 藥物名稱統一表（口語/品牌名 → 標準名稱）
DRUG_ALIASES: dict[str, str] = {
    "普拿疼": "Acetaminophen",
    "panadol": "Acetaminophen",
    "百服寧": "Acetaminophen",
    "沃恩": "Voltaren",
    "voren": "Voltaren",
    "伏冒": "Voltaren",
    "阿斯匹靈": "Aspirin",
    "aspirin": "Aspirin",
    "脈優": "Amlodipine",
    "耐適恩": "Nexium",
    "服樂泄": "Furosemide",
    "lasix": "Furosemide",
}


def remove_filler(text: str) -> str:
    """移除口語贅詞與冗餘符號"""
    # 移除常見贅詞
    fillers = ["嗯", "啊", "呃", "那個", "就是", "然後然後", "對對對"]
    for f in fillers:
        text = text.replace(f, "")

    # 移除多餘空白與重複標點
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"[，,]{2,}", "，", text)
    text = re.sub(r"[。.]{2,}", "。", text)
    return text.strip()


def normalize_drugs(text: str) -> str:
    """統一藥物名稱"""
    for alias, standard in DRUG_ALIASES.items():
        text = re.sub(re.escape(alias), standard, text, flags=re.IGNORECASE)
    return text


def normalize_units(text: str) -> str:
    """統一劑量單位格式"""
    # 中文數字轉阿拉伯
    cn_nums = {"一": "1", "二": "2", "三": "3", "四": "4", "五": "5",
               "六": "6", "七": "7", "八": "8", "九": "9", "十": "10"}
    for cn, num in cn_nums.items():
        text = re.sub(f"{cn}顆", f"{num}顆", text)
        text = re.sub(f"{cn}粒", f"{num}粒", text)

    # 統一毫克寫法
    text = re.sub(r"毫克", "mg", text)
    text = re.sub(r"公克", "g", text)
    text = re.sub(r"毫升", "ml", text)
    text = re.sub(r"c\.?c\.?", "ml", text, flags=re.IGNORECASE)
    return text


def clean(text: str) -> str:
    """完整清理流程"""
    text = remove_filler(text)
    text = normalize_drugs(text)
    text = normalize_units(text)
    return text

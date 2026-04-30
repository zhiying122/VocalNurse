"""
隱私遮罩 (PII Redaction)
自動偵測並打碼病患姓名、身分證字號、電話等個資
符合台灣醫療個資法 (PDPA) 要求
"""
import re


# 台灣身分證字號格式：1 英文字母 + 9 數字
ID_PATTERN = re.compile(r'[A-Z][12]\d{8}')

# 電話號碼（手機 09xx-xxx-xxx 或市話 0x-xxxx-xxxx）
PHONE_PATTERN = re.compile(r'09\d{2}[-\s]?\d{3}[-\s]?\d{3}|0\d[-\s]?\d{4}[-\s]?\d{4}')

# 常見姓名模式（中文 2-4 字，前面有「病患」「家屬」「先生」「小姐」等提示詞）
NAME_CONTEXT_PATTERN = re.compile(
    r'(?:病患|病人|家屬|先生|小姐|太太|阿公|阿嬤|阿伯|阿姨)\s*'
    r'([\u4e00-\u9fff]{2,4})'
)

# Email
EMAIL_PATTERN = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')

# 地址（含「路」「街」「巷」「弄」「號」「樓」）
ADDRESS_PATTERN = re.compile(r'[\u4e00-\u9fff]{2,}(?:路|街|巷|弄|號|樓)[\u4e00-\u9fff0-9]*')


def redact_pii(text: str) -> str:
    """
    遮罩所有偵測到的個人資訊

    Returns:
        遮罩後的文字
    """
    # 身分證
    text = ID_PATTERN.sub('[身分證已遮罩]', text)

    # 電話
    text = PHONE_PATTERN.sub('[電話已遮罩]', text)

    # Email
    text = EMAIL_PATTERN.sub('[Email已遮罩]', text)

    # 姓名（僅在有上下文提示時遮罩，避免誤判）
    def mask_name(match):
        full = match.group(0)
        name = match.group(1)
        prefix = full[: len(full) - len(name)]
        return prefix + '[姓名已遮罩]'
    text = NAME_CONTEXT_PATTERN.sub(mask_name, text)

    return text

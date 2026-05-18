"""
LLM 客戶端：支援 Ollama 本地（主）、Gemini、OpenAI（備援）
"""
import json
import os
import re
from dotenv import load_dotenv

load_dotenv()

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama")


def _extract_json(text: str) -> dict:
    """從 LLM 回應中提取 JSON，處理各種格式問題"""
    print(f"[LLM] 原始回應長度: {len(text)}, 前200字: {repr(text[:200])}")

    if not text or not text.strip():
        raise ValueError("LLM 回傳空回應")

    # 1. 嘗試提取 ```json ... ``` 包裹的內容
    fence_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1).strip()
    else:
        text = text.strip()

    # 2. 找到第一個 { 和最後一個 } 之間的內容
    start = text.find('{')
    if start == -1:
        raise ValueError(f"回應中找不到 JSON: {text[:200]}")

    # 用括號計數找到匹配的 }
    depth = 0
    end = start
    for i in range(start, len(text)):
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
            if depth == 0:
                end = i + 1
                break

    json_str = text[start:end]
    print(f"[LLM] 提取 JSON 長度: {len(json_str)}")
    return json.loads(json_str)


def call_ollama(system_prompt: str, user_prompt: str) -> dict:
    """
    呼叫本地 Ollama LLM 生成 SOAP JSON。
    timeout=180 秒：Ollama 第一次載入模型時需要較長時間，
    後續呼叫會快很多（模型已在記憶體中）。
    num_predict=1024：限制輸出 token 數，加速回應並避免模型過度生成。
    """
    from langchain_ollama import ChatOllama
    from langchain_core.messages import SystemMessage, HumanMessage

    model = os.getenv("OLLAMA_MODEL", "llama3.2:latest")
    llm = ChatOllama(
        model=model,
        base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
        temperature=0.1,
        timeout=180,
        num_predict=2048,
    )
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ]
    response = llm.invoke(messages)
    return _extract_json(response.content)


def call_gemini(system_prompt: str, user_prompt: str) -> dict:
    from langchain_google_genai import ChatGoogleGenerativeAI
    from langchain_core.messages import SystemMessage, HumanMessage

    llm = ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        google_api_key=os.getenv("GEMINI_API_KEY"),
        temperature=0.1,
    )
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ]
    response = llm.invoke(messages)
    return _extract_json(response.content)


def call_openai(system_prompt: str, user_prompt: str) -> dict:
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import SystemMessage, HumanMessage

    llm = ChatOpenAI(
        model="gpt-4o",
        api_key=os.getenv("OPENAI_API_KEY"),
        temperature=0.1,
    )
    messages = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ]
    response = llm.invoke(messages)
    return _extract_json(response.content)


def call_llm(system_prompt: str, user_prompt: str) -> dict:
    """
    主入口：依 LLM_PROVIDER 決定順序，失敗自動備援
    ollama（預設）→ gemini → openai
    """
    if LLM_PROVIDER == "gemini":
        order = [call_gemini, call_ollama, call_openai]
    elif LLM_PROVIDER == "openai":
        order = [call_openai, call_ollama, call_gemini]
    else:  # ollama（預設）
        order = [call_ollama, call_gemini, call_openai]

    last_error = None
    for provider_fn in order:
        try:
            return provider_fn(system_prompt, user_prompt)
        except Exception as e:
            last_error = e
            print(f"[LLM] {provider_fn.__name__} 失敗，嘗試備援... ({e})")

    raise RuntimeError(f"所有 LLM 提供者均失敗：{last_error}")

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
    """從 LLM 回應中提取 JSON，處理可能的 markdown code block"""
    # 先嘗試提取 ```json ... ``` 或 ``` ... ``` 包裹的內容
    fence_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?\s*```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1).strip()
    else:
        # 沒有 code fence，直接去除首尾空白
        text = text.strip()
    return json.loads(text)


def call_ollama(system_prompt: str, user_prompt: str) -> dict:
    from langchain_ollama import ChatOllama
    from langchain_core.messages import SystemMessage, HumanMessage

    model = os.getenv("OLLAMA_MODEL", "llama3.1:8b")
    llm = ChatOllama(
        model=model,
        base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
        temperature=0.1,
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

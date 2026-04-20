"""
LLM 客戶端：支援 Ollama 本地（主）、Gemini、OpenAI
"""
import json
import os
import re
from dotenv import load_dotenv

load_dotenv()

LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama")


def _extract_json(text: str) -> dict:
    """從 LLM 回應中提取 JSON，處理可能的 markdown code block"""
    # 移除 ```json ... ``` 包裝
    text = re.sub(r"```json\s*", "", text)
    text = re.sub(r"```\s*", "", text)
    text = text.strip()
    return json.loads(text)


def call_gemini(system_prompt: str, user_prompt: str) -> dict:
    from langchain_google_genai import ChatGoogleGenerativeAI
    from langchain_core.messages import SystemMessage, HumanMessage

    llm = ChatGoogleGenerativeAI(
        model="gemini-2.0-flash",
        google_api_key=os.getenv("GEMINI_API_KEY"),
        temperature=0.1,  # 低溫確保輸出穩定
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
    主入口：優先使用設定的 provider，失敗時自動備援
    """
    providers = (
        [call_gemini, call_openai]
        if LLM_PROVIDER == "gemini"
        else [call_openai, call_gemini]
    )

    last_error = None
    for provider_fn in providers:
        try:
            return provider_fn(system_prompt, user_prompt)
        except Exception as e:
            last_error = e
            print(f"[LLM] {provider_fn.__name__} 失敗，嘗試備援... ({e})")

    raise RuntimeError(f"所有 LLM 提供者均失敗：{last_error}")

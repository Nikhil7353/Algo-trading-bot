import json
import logging
import os
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
import requests
from dotenv import load_dotenv

logger = logging.getLogger("stockbot.ai_assistant")
load_dotenv()


class BaseAIClient(ABC):
    """Abstract base class for AI LLM providers."""

    @abstractmethod
    def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.2,
        max_tokens: int = 1024,
    ) -> Dict[str, Any]:
        """
        Executes a chat completion with optional tool/function calling.
        Returns a dict: {"content": str, "tool_calls": List[Dict], "raw": Any}
        """
        pass

    @abstractmethod
    def generate_text(
        self,
        prompt: str,
        system_prompt: str = "",
        temperature: float = 0.3,
        max_tokens: int = 512,
    ) -> str:
        """Executes a direct text generation query."""
        pass

    @abstractmethod
    def is_available(self) -> bool:
        """Returns True if the API key and provider are configured."""
        pass


class OpenAICompatibleClient(BaseAIClient):
    """
    OpenAI-compatible LLM client supporting Groq, Nemotron, OpenAI, etc.
    Swappable purely via AI_BASE_URL, AI_MODEL, and GROQ_API_KEY / AI_API_KEY.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        provider: Optional[str] = None,
    ):
        self.provider = (provider or os.getenv("AI_PROVIDER", "groq")).lower()
        self.api_key = (
            api_key
            or os.getenv("GROQ_API_KEY")
            or os.getenv("AI_API_KEY")
            or os.getenv("OPENAI_API_KEY", "")
        ).strip()
        self.base_url = (
            base_url
            or os.getenv("AI_BASE_URL")
            or ("https://api.groq.com/openai/v1" if self.provider == "groq" else "https://api.openai.com/v1")
        ).rstrip("/")
        self.model = (
            model
            or os.getenv("AI_MODEL")
            or ("openai/gpt-oss-20b" if self.provider == "groq" else "gpt-4o-mini")
        ).strip()
        self.timeout = int(os.getenv("AI_REQUEST_TIMEOUT", "20"))

    def is_available(self) -> bool:
        return bool(self.api_key and len(self.api_key) > 5)

    def chat_completion(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: float = 0.2,
        max_tokens: int = 1024,
    ) -> Dict[str, Any]:
        if not self.is_available():
            raise ValueError(f"AI Provider '{self.provider}' is not configured. Missing GROQ_API_KEY.")

        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        # Keep messages compact to fit TPM budget
        trimmed_messages = messages[-8:] if len(messages) > 8 else messages

        payload: Dict[str, Any] = {
            "messages": trimmed_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        models_to_try = [self.model]
        if self.provider == "groq":
            for fallback in ["openai/gpt-oss-20b", "qwen/qwen3.6-27b", "openai/gpt-oss-120b"]:
                if fallback not in models_to_try:
                    models_to_try.append(fallback)

        last_error = None
        for attempt_model in models_to_try:
            payload["model"] = attempt_model
            try:
                resp = requests.post(url, headers=headers, json=payload, timeout=self.timeout)
                if resp.status_code == 429:
                    logger.warning("Groq rate limit on model %s, trying fallback model...", attempt_model)
                    time.sleep(1.0)
                    continue

                resp.raise_for_status()
                data = resp.json()
                choice = data["choices"][0]
                msg = choice.get("message", {})

                return {
                    "content": msg.get("content") or "",
                    "tool_calls": msg.get("tool_calls") or [],
                    "raw": data,
                    "finish_reason": choice.get("finish_reason", "stop"),
                }
            except requests.exceptions.Timeout:
                logger.error("AI client timed out on model %s", attempt_model)
                last_error = TimeoutError(f"AI client request timed out after {self.timeout} seconds")
            except requests.exceptions.RequestException as e:
                err_msg = resp.text if "resp" in locals() and resp is not None else str(e)
                logger.warning("AI client request failed on %s: %s", attempt_model, err_msg)
                last_error = RuntimeError(f"AI API request failed: {err_msg}")

        if last_error:
            raise last_error

    def generate_text(
        self,
        prompt: str,
        system_prompt: str = "",
        temperature: float = 0.3,
        max_tokens: int = 512,
    ) -> str:
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        res = self.chat_completion(messages, tools=None, temperature=temperature, max_tokens=max_tokens)
        return res.get("content", "").strip()


# Alias GroqClient to OpenAICompatibleClient
GroqClient = OpenAICompatibleClient

_client_instance: Optional[BaseAIClient] = None


def get_ai_client() -> BaseAIClient:
    """Returns the singleton AI client instance configured from environment."""
    global _client_instance
    if _client_instance is None:
        _client_instance = OpenAICompatibleClient()
    return _client_instance

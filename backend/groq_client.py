"""Shared low-level Groq chat-completions client.

Both summarize_meeting.py (structured JSON summarization) and chat.py
(free-text RAG answers) need to call Groq's chat completions endpoint with
the same auth/model/error-handling - that shared plumbing lives here once,
rather than being duplicated per feature. Each caller still builds its own
request body (system prompt, response_format, messages) since those are
feature-specific; only the actual HTTP call and the errors common to any
call (auth, rate limit, network failure) are shared.

Model/API details confirmed against Groq's current docs and live
/models endpoint - see summarize_meeting.py's docstring for the full
history of why openai/gpt-oss-120b was chosen over llama-3.3-70b-versatile.
"""

import httpx

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "openai/gpt-oss-120b"
GROQ_CONTEXT_WINDOW_TOKENS = 131_072


class GroqError(Exception):
    """Base class for errors from the shared Groq client."""


class GroqConfigError(GroqError):
    """GROQ_API_KEY missing entirely - a config problem, not an API failure."""


class GroqAuthError(GroqError):
    """Groq rejected the API key (401)."""


class GroqRateLimitError(GroqError):
    """Groq rate-limited the request (429)."""


class GroqAPIError(GroqError):
    """Network error or an unexpected status code."""


def require_api_key() -> str:
    import os

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise GroqConfigError("GROQ_API_KEY is not set in backend/.env.")
    return api_key


def post_chat_completion(body: dict, api_key: str) -> httpx.Response:
    """Raw POST to Groq's chat completions endpoint.

    Raises GroqAuthError (401), GroqRateLimitError (429), or GroqAPIError
    (network failure) - anything else, including 200 and 400, is returned
    as-is for the caller to interpret. What counts as retryable vs. fatal
    differs between strict-JSON-schema summarization (where a 400 usually
    means the model's output failed schema validation, and is worth a
    retry) and free-text chat answers (where a 400 would mean a malformed
    request, not something retrying fixes) - that interpretation belongs
    to each caller, not this shared layer.
    """
    try:
        response = httpx.post(
            GROQ_API_URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=body,
            timeout=60.0,
        )
    except httpx.RequestError as exc:
        raise GroqAPIError(f"network error calling Groq's API: {exc}") from exc

    if response.status_code == 401:
        raise GroqAuthError("Groq API key is invalid (401 Unauthorized). Check GROQ_API_KEY in backend/.env.")
    if response.status_code == 429:
        raise GroqRateLimitError("Groq API rate limit hit (429). Try again later - not retrying automatically.")

    return response

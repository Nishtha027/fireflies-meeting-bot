"""
Fetch a meeting's stored transcript, summarize it via Groq (openai/gpt-oss-120b),
and save the structured result into summaries + action_items.

Usage:
    python summarize_meeting.py --meeting-id 1

Re-running against the same meeting_id replaces the previous summary and
action items (delete-then-insert / update-in-place) rather than creating
duplicates - same idempotency goal as ingest_transcript.py.

The summarize() function is also called directly by main.py's
POST /meetings/{id}/summarize endpoint - it raises SummarizeError subclasses
instead of printing+sys.exit() so callers (CLI or API) can each handle
errors their own way (stderr+exit code vs. an HTTP response).

Model/API details confirmed against Groq's current docs (console.groq.com),
AND against their live /models endpoint with the real API key, since the
two disagreed:
  - Docs describe llama-3.3-70b-versatile as the current Llama 3.3 70B
    model id. Live behavior: this account's key gets a 404 model_not_found
    for it, and it's absent from GET /openai/v1/models for this key. Not
    guessing past that - confirmed with the user and switched to
    openai/gpt-oss-120b, which IS present in the live model list.
  - openai/gpt-oss-120b: 131,072-token context window, 65,536 max
    completion tokens, supports strict JSON Schema structured outputs
    (unlike llama-3.3-70b-versatile, which only ever had JSON Object Mode
    available) - so responses are schema-enforced, not just valid-JSON.
  - Endpoint: https://api.groq.com/openai/v1/chat/completions
"""

import argparse
import json
import sys
from dataclasses import dataclass, field

from dotenv import load_dotenv

# Windows' console defaults stdout/stderr to cp1252, which can't encode
# characters models sometimes use (e.g. U+2011 non-breaking hyphen).
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

from app.database import SessionLocal
from app.models import ActionItem, Meeting, Summary, TranscriptSegment
from groq_client import (
    GROQ_CONTEXT_WINDOW_TOKENS,
    GROQ_MODEL,
    GroqAPIError,
    GroqAuthError,
    GroqConfigError,
    GroqError,
    GroqRateLimitError,
    post_chat_completion,
    require_api_key,
)

load_dotenv()


class SummarizeError(Exception):
    """Base class for errors summarize() raises - callers decide how to present them."""


class MeetingNotFoundError(SummarizeError):
    pass


class NoTranscriptError(SummarizeError):
    pass


class TranscriptTooLongError(SummarizeError):
    pass


@dataclass
class SummarizeResult:
    meeting_id: int
    overview: str
    key_points: list[str]
    decisions: list[str]
    action_items: list[dict] = field(default_factory=list)  # [{"description": ..., "assignee": ...}]


RESPONSE_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "overview": {"type": "string"},
        "key_points": {"type": "array", "items": {"type": "string"}},
        "decisions": {"type": "array", "items": {"type": "string"}},
        "action_items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "description": {"type": "string"},
                    "assignee": {"type": "string"},
                },
                "required": ["description", "assignee"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["overview", "key_points", "decisions", "action_items"],
    "additionalProperties": False,
}
# Conservative ceiling before we warn: leaves headroom for the system
# prompt and completion tokens (up to 65,536 max_completion_tokens for
# this model).
SAFE_TRANSCRIPT_TOKEN_BUDGET = 90_000

SYSTEM_PROMPT = """You are an assistant that summarizes meeting transcripts for a \
Fireflies.ai-style meeting notes product. You will be given a transcript with \
speaker-labeled lines. The response format (overview / key_points / decisions / \
action_items) is enforced separately - focus only on the content rules below.

Rules:
- "decisions" must ONLY contain things the transcript shows were actually agreed \
  or committed to - not opinions, suggestions, or ideas that were merely discussed \
  or considered without a clear resolution. If nothing was actually decided, return \
  an empty array.
- For "assignee" in action_items: only name a specific person if the transcript \
  reasonably makes it clear they own that task. Do not guess or infer an assignee \
  from weak evidence. If it's unclear, use exactly "Unassigned".
- If the transcript is too short or unclear to support a field, return an empty \
  array or a brief honest overview rather than inventing content.
"""


def _estimate_tokens(text: str) -> int:
    # Rough, conservative estimate (~3.5 chars/token for English) - good
    # enough for a safety check, not meant to be exact.
    return len(text) // 3


def build_transcript_text(meeting_id: int, session) -> str:
    segments = (
        session.query(TranscriptSegment)
        .filter_by(meeting_id=meeting_id)
        .order_by(TranscriptSegment.start_timestamp)
        .all()
    )
    if not segments:
        return ""
    return "\n".join(f"[{seg.speaker_label}]: {seg.text}" for seg in segments)


def call_groq(transcript_text: str, api_key: str, retry_hint: str | None = None):
    """Returns (raw_json_response, None) on success, or (None, error_str) on a
    retryable failure (schema/parse issue). Hard failures (auth, rate limit,
    network, other non-200) raise instead of returning - those aren't the
    retry-once case, they're "stop now"."""
    user_content = transcript_text
    if retry_hint:
        user_content = (
            f"{transcript_text}\n\n---\n"
            f"Your previous response didn't satisfy the required format ({retry_hint}). "
            f"Try again."
        )

    body = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "meeting_summary", "strict": True, "schema": RESPONSE_JSON_SCHEMA},
        },
        "temperature": 0.2,
    }

    # post_chat_completion raises GroqAuthError/GroqRateLimitError/GroqAPIError
    # for 401/429/network failures - only 400 (schema-validation failure,
    # retryable here) and non-200/400 need handling below.
    response = post_chat_completion(body, api_key)

    if response.status_code == 400:
        # Strict JSON Schema mode can 400 when the model's own output fails
        # schema validation - treat this as retryable, same as malformed JSON.
        return None, f"400 from Groq (likely a schema-validation failure): {response.text}"
    if response.status_code != 200:
        raise GroqAPIError(f"Groq API returned {response.status_code}: {response.text}")

    return response.json(), None


def parse_groq_response(raw_response: dict) -> dict:
    content = raw_response["choices"][0]["message"]["content"]
    return json.loads(content), content


REQUIRED_KEYS = {"overview", "key_points", "decisions", "action_items"}


def validate_shape(parsed: dict) -> str | None:
    """Returns an error description if the shape is wrong, else None."""
    missing = REQUIRED_KEYS - parsed.keys()
    if missing:
        return f"missing keys: {sorted(missing)}"
    if not isinstance(parsed["key_points"], list) or not isinstance(parsed["decisions"], list):
        return "key_points/decisions must be arrays"
    if not isinstance(parsed["action_items"], list):
        return "action_items must be an array"
    for item in parsed["action_items"]:
        if not isinstance(item, dict) or "description" not in item or "assignee" not in item:
            return "each action_items entry must have description and assignee"
    return None


def _try_parse(raw, api_error):
    """Returns (parsed_dict, error_description). error_description is None on success."""
    if api_error:
        return None, api_error
    try:
        parsed, content = parse_groq_response(raw)
    except (KeyError, IndexError, json.JSONDecodeError) as exc:
        return None, f"response wasn't parseable JSON: {exc}"
    shape_error = validate_shape(parsed)
    if shape_error:
        return None, f"response was valid JSON but wrong shape: {shape_error}"
    return parsed, None


def get_structured_summary(transcript_text: str, api_key: str) -> dict:
    raw, api_error = call_groq(transcript_text, api_key)
    parsed, error = _try_parse(raw, api_error)

    if parsed is None:
        print(f"WARNING: Groq {error}. Retrying once...")
        raw, api_error = call_groq(transcript_text, api_key, retry_hint=error)
        parsed, error = _try_parse(raw, api_error)

        if parsed is None:
            raise GroqAPIError(f"Groq response still bad after retry: {error}")

    return parsed


def save_summary(session, meeting_id: int, parsed: dict) -> int:
    # Delete-then-insert for both tables: simplest correct idempotency here
    # since individual action items have no stable natural key across
    # re-generations (the LLM's phrasing can change run to run).
    session.query(Summary).filter_by(meeting_id=meeting_id).delete()
    session.query(ActionItem).filter_by(meeting_id=meeting_id).delete()

    session.add(
        Summary(
            meeting_id=meeting_id,
            overview_text=parsed["overview"],
            key_points=parsed["key_points"],
            decisions=parsed["decisions"],
        )
    )
    for item in parsed["action_items"]:
        session.add(
            ActionItem(
                meeting_id=meeting_id,
                description=item["description"],
                assignee_guess=item["assignee"],
            )
        )

    session.commit()
    return len(parsed["action_items"])


def summarize(meeting_id: int) -> SummarizeResult:
    """Fetch the stored transcript for meeting_id, summarize it via Groq, and
    save the result. Raises SummarizeError subclasses on failure - never
    calls sys.exit(), so it's safe to call from a web request."""
    api_key = require_api_key()

    session = SessionLocal()
    try:
        meeting = session.get(Meeting, meeting_id)
        if meeting is None:
            raise MeetingNotFoundError(f"no meeting with id={meeting_id} in the database.")

        print(f"Summarizing meeting id={meeting_id} ({meeting.platform}/{meeting.native_meeting_id}, status={meeting.status!r})...")

        transcript_text = build_transcript_text(meeting_id, session)
        if not transcript_text:
            raise NoTranscriptError(f"meeting id={meeting_id} has no transcript_segments. Nothing to summarize.")

        estimated_tokens = _estimate_tokens(transcript_text)
        print(f"Transcript: {len(transcript_text)} chars, ~{estimated_tokens} tokens "
              f"(Groq's {GROQ_MODEL} context window is {GROQ_CONTEXT_WINDOW_TOKENS} tokens).")
        if estimated_tokens > SAFE_TRANSCRIPT_TOKEN_BUDGET:
            raise TranscriptTooLongError(
                f"transcript (~{estimated_tokens} tokens) is close to or over the "
                f"context window. Refusing to silently truncate - this needs a chunking "
                f"strategy before proceeding. Not summarizing."
            )

        parsed = get_structured_summary(transcript_text, api_key)
        print("Groq API call succeeded and returned a valid structured response.")

        action_item_count = save_summary(session, meeting_id, parsed)
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    return SummarizeResult(
        meeting_id=meeting_id,
        overview=parsed["overview"],
        key_points=parsed["key_points"],
        decisions=parsed["decisions"],
        action_items=parsed["action_items"],
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--meeting-id", required=True, type=int, help="Our own meetings.id (not Vexa's)")
    args = parser.parse_args()

    try:
        result = summarize(args.meeting_id)
    except (SummarizeError, GroqError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"\nOverview: {result.overview}")
    print(f"Key points: {len(result.key_points)}, Decisions: {len(result.decisions)}, "
          f"Action items: {len(result.action_items)}")
    print(f"Saved to database for meeting_id={result.meeting_id}.")


if __name__ == "__main__":
    main()

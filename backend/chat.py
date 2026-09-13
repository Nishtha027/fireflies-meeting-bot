"""
Answer natural-language questions about the user's own meetings using
retrieval-augmented generation: embed the question with the same local
model used to index meetings, retrieve the top-k most relevant chunks from
Chroma across every meeting THAT USER OWNS (never another user's - see the
user_id filter in answer_question() below), then ask Groq to answer using
ONLY that retrieved context (reusing the shared Groq client, not a separate
integration).

Single-turn only, per project scope: each call answers one question fresh
from retrieval - no conversation history is carried between calls, and
none is persisted. The frontend may still display a running list of past
Q&A pairs for the current session, but that's a client-side concern only.
"""

import re
from dataclasses import dataclass, field

from embeddings import get_collection, get_model
from groq_client import (
    GroqAPIError,
    GroqAuthError,
    GroqConfigError,
    GroqError,
    GroqRateLimitError,
    GROQ_MODEL,
    post_chat_completion,
    require_api_key,
)

# Retrieved chunks are small (a summary section, or ~400 words of
# transcript), and our per-meeting chunk count is currently tiny, so k=6
# comfortably covers multiple chunk types and/or multiple meetings without
# diluting the prompt with marginally-relevant filler.
TOP_K = 6

SYSTEM_PROMPT = """You are a Q&A assistant for a meeting-notes product. You are given \
several excerpts retrieved from the user's own recorded meetings (summaries and \
transcripts), followed by a question.

Rules:
- Answer ONLY using the information in the excerpts below. Do not use any outside or \
general knowledge, and do not guess or infer beyond what the excerpts actually say.
- Do not add specifics that are not explicitly present in the excerpts - a name, a \
number, a location, or any part of a date that isn't literally written in the text \
below. If it isn't there, leave it out rather than filling it in.
- HARD RULE, NO EXCEPTIONS: never write a 4-digit year anywhere in your answer unless \
that exact year appears verbatim, as digits, in the excerpts below. Not in the answer \
text, not in parentheses, not as a clarification. If a date in the excerpts has no \
year attached, your answer must repeat that date with no year attached either.
- If the excerpts don't contain enough information to answer the question, say clearly \
and honestly that you don't have that information in the user's meetings. Never \
fabricate an answer just to seem helpful.
- When you do answer, be direct and specific about what was actually said or decided, \
and which meeting it came from if that's clear from the excerpts.
"""


class ChatError(Exception):
    """Base class for errors answer_question() raises."""


class EmptyQuestionError(ChatError):
    pass


class NoIndexedMeetingsError(ChatError):
    """Nothing has been embedded yet - Chroma's collection is empty."""


@dataclass
class ChatSource:
    meeting_id: int
    native_meeting_id: str
    platform: str
    start_time: str | None
    chunk_type: str
    snippet: str


@dataclass
class ChatResult:
    answer: str
    sources: list[ChatSource] = field(default_factory=list)


_YEAR_RE = re.compile(r"(19|20)\d{2}")
_PARENTHETICAL_YEAR_RE = re.compile(r"\s*\((?:19|20)\d{2}\)")
_BARE_YEAR_RE = re.compile(r",?\s*\b(?:19|20)\d{2}\b")


def _strip_ungrounded_years(answer: str, context: str) -> str:
    """Safety net for a failure mode observed during testing: the model
    would sometimes infer and append a plausible year to a bare date (e.g.
    "Monday, September 23rd" -> "...(2024)") by calculating which real
    year that day-of-week/date combination falls on - outside knowledge
    (calendar math), not something from the excerpts, however confident it
    sounds. The system/user prompt now explicitly forbids this, but this
    check costs little and closes the gap mechanically regardless: if the
    retrieved context contains no year at all, any year in the model's
    answer could not have come from that context, so it's removed before
    the user ever sees it. Answers whose context genuinely does contain a
    year are left untouched.
    """
    if _YEAR_RE.search(context):
        return answer
    cleaned = _PARENTHETICAL_YEAR_RE.sub("", answer)
    cleaned = _BARE_YEAR_RE.sub("", cleaned)
    return cleaned


def _build_context(ids: list[str], documents: list[str], metadatas: list[dict]) -> str:
    parts = []
    for i, (document, metadata) in enumerate(zip(documents, metadatas), start=1):
        label = metadata.get("chunk_type", "content")
        native_id = metadata.get("native_meeting_id", metadata.get("meeting_id"))
        parts.append(f"[Excerpt {i} - {label} from meeting {native_id}]\n{document}")
    return "\n\n".join(parts)


def answer_question(question: str, user_id: int) -> ChatResult:
    """Raises ChatError/GroqError subclasses - never calls sys.exit(), safe
    to call from a web request.

    Retrieval is filtered to user_id's own embedded chunks (a Chroma `where`
    match on metadata.user_id - see embeddings.py) at every step, including
    the "has anything been indexed" check below: a collection that has
    plenty of OTHER users' chunks but none of this user's must still behave
    as if nothing has been indexed for them, never fall through to a
    cross-user answer."""
    question = question.strip()
    if not question:
        raise EmptyQuestionError("question must not be empty.")

    api_key = require_api_key()

    collection = get_collection()
    user_chunks = collection.get(where={"user_id": user_id})
    if not user_chunks["ids"]:
        raise NoIndexedMeetingsError(
            "No meetings have been indexed for chat yet. Run POST /embed-all first."
        )

    model = get_model()
    question_embedding = model.encode([question]).tolist()

    results = collection.query(
        query_embeddings=question_embedding,
        n_results=TOP_K,
        where={"user_id": user_id},
    )
    ids = results["ids"][0]
    documents = results["documents"][0]
    metadatas = results["metadatas"][0]

    context = _build_context(ids, documents, metadatas)
    user_content = (
        f"{context}\n\n---\n\nQuestion: {question}\n\n"
        f"(Reminder: use only the excerpts above. Do not add a year to any date "
        f"unless that year literally appears in the excerpts above.)"
    )

    body = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        "temperature": 0.2,
    }

    response = post_chat_completion(body, api_key)
    if response.status_code != 200:
        raise GroqAPIError(f"Groq API returned {response.status_code}: {response.text}")

    raw = response.json()
    answer = raw["choices"][0]["message"]["content"]
    answer = _strip_ungrounded_years(answer, context)

    sources = [
        ChatSource(
            meeting_id=metadata["meeting_id"],
            native_meeting_id=metadata.get("native_meeting_id", ""),
            platform=metadata.get("platform", ""),
            start_time=metadata.get("start_time"),
            chunk_type=metadata.get("chunk_type", "unknown"),
            snippet=document[:200] + ("…" if len(document) > 200 else ""),
        )
        for document, metadata in zip(documents, metadatas)
    ]

    return ChatResult(answer=answer, sources=sources)

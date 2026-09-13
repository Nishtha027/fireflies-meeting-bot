"""
Turn each meeting's summary + transcript into embedded chunks stored in a
local, persistent Chroma collection, so the /chat RAG feature can retrieve
relevant content across every meeting.

Usage:
    python embeddings.py --meeting-id 1
    python embeddings.py --all

Two chunk levels per meeting (see chunk_summary()/chunk_transcript() below):
  - "summary" chunks: one each for overview / key_points / decisions (when
    present) - good for high-level "what did we decide" style questions.
  - "transcript" chunks: consecutive transcript_segments grouped into
    ~400-word windows (not one chunk per segment, which would be too
    granular and lose surrounding context) - good for detailed "what
    exactly was said about X" style questions.

embed_meeting() deletes a meeting's existing chunks before adding the fresh
set, rather than upserting by id - the same delete-then-insert idempotency
pattern summarize_meeting.py already uses, and necessary here specifically
because the NUMBER of transcript chunks can change between runs (a plain
upsert-by-id would leave stale extra chunks behind if a re-run produces
fewer chunks than a previous one did).

"Embedded" is tracked by querying Chroma itself (does this meeting_id have
any chunks already?) rather than adding a new embedded_at column to
meetings - we don't need audit history or staleness detection in this
phase, and this way the fact is derived from where it actually lives
instead of duplicated into Postgres.

Also used directly by main.py's POST /meetings/{id}/embed and POST
/embed-all endpoints - functions here raise EmbeddingError subclasses
instead of printing+sys.exit(), same pattern as ingest_transcript.py and
summarize_meeting.py.
"""

import argparse
import os
import sys
from dataclasses import dataclass, field

from dotenv import load_dotenv

if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# Must be set before importing sentence_transformers/huggingface_hub: their
# default model cache lives under the user's home directory, which on this
# machine is on a nearly-full system drive. Redirected next to this project
# instead (gitignored, like chroma_data/ - it's a regeneratable download
# cache, not source of truth) so a first-time model download doesn't fail
# for lack of disk space on an unrelated drive.
os.environ.setdefault(
    "HF_HOME", os.path.join(os.path.dirname(os.path.abspath(__file__)), "hf_cache")
)

import chromadb
from sentence_transformers import SentenceTransformer

from app.database import SessionLocal
from app.models import Meeting, Summary, TranscriptSegment

load_dotenv()

# Purpose-trained on ~215M question/answer pairs for asymmetric query-to-
# passage retrieval (embed a natural-language question, match it against
# document chunks) - a better fit for this RAG use case than a general
# sentence-similarity model like all-MiniLM-L6-v2, at the same size/speed
# (384-dim, MiniLM-L6 architecture, CPU-friendly). Confirmed against
# sentence-transformers' current pretrained-models docs (sbert.net).
EMBEDDING_MODEL_NAME = "multi-qa-MiniLM-L6-cos-v1"

CHROMA_DATA_DIR = "chroma_data"
COLLECTION_NAME = "meeting_chunks"

# ~400 words/chunk: big enough to keep surrounding context (a single
# segment is often one short utterance), small enough that a chunk stays
# about one topic rather than blending several unrelated ones together.
TRANSCRIPT_CHUNK_TARGET_WORDS = 400


class EmbeddingError(Exception):
    """Base class for errors embed_meeting() raises."""


class MeetingNotFoundError(EmbeddingError):
    pass


class NoContentError(EmbeddingError):
    """Meeting has neither a summary nor a transcript - nothing to embed."""


_model: SentenceTransformer | None = None
_collection = None


def get_model() -> SentenceTransformer:
    """Lazily loaded, cached at module level - loading the model has a
    real one-time cost (reading weights off disk), so we only pay it once
    per process, not once per request."""
    global _model
    if _model is None:
        print(f"Loading embedding model {EMBEDDING_MODEL_NAME!r} (first call only)...")
        _model = SentenceTransformer(EMBEDDING_MODEL_NAME)
    return _model


def get_collection():
    global _collection
    if _collection is None:
        client = chromadb.PersistentClient(path=CHROMA_DATA_DIR)
        # multi-qa-MiniLM-L6-cos-v1 was trained/is intended to be compared
        # with cosine similarity, not Chroma's default (squared L2).
        _collection = client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


@dataclass
class Chunk:
    id: str
    text: str
    metadata: dict


def _meeting_metadata(meeting: Meeting) -> dict:
    # Chroma metadata values must be str/int/float/bool - no None - so
    # start_time and user_id are only included when the meeting actually
    # has one. A legacy meeting with no owner yet (user_id is None) is
    # embedded with no "user_id" key at all, rather than some placeholder -
    # chat.py's retrieval always filters by an exact user_id match, so a
    # chunk with no user_id key can never surface in any user's answers
    # until the meeting is actually assigned an owner and re-embedded.
    meta = {
        "meeting_id": meeting.id,
        "platform": meeting.platform,
        "native_meeting_id": meeting.native_meeting_id,
    }
    if meeting.start_time is not None:
        meta["start_time"] = meeting.start_time.isoformat()
    if meeting.user_id is not None:
        meta["user_id"] = meeting.user_id
    return meta


def chunk_summary(meeting: Meeting, summary: Summary | None) -> list[Chunk]:
    if summary is None:
        return []

    base_meta = _meeting_metadata(meeting)
    chunks: list[Chunk] = []

    if summary.overview_text:
        chunks.append(
            Chunk(
                id=f"{meeting.id}:summary:overview",
                text=f"Meeting overview: {summary.overview_text}",
                metadata={**base_meta, "chunk_type": "summary", "summary_section": "overview"},
            )
        )
    if summary.key_points:
        text = "Key points discussed:\n" + "\n".join(f"- {p}" for p in summary.key_points)
        chunks.append(
            Chunk(
                id=f"{meeting.id}:summary:key_points",
                text=text,
                metadata={**base_meta, "chunk_type": "summary", "summary_section": "key_points"},
            )
        )
    if summary.decisions:
        text = "Decisions made:\n" + "\n".join(f"- {d}" for d in summary.decisions)
        chunks.append(
            Chunk(
                id=f"{meeting.id}:summary:decisions",
                text=text,
                metadata={**base_meta, "chunk_type": "summary", "summary_section": "decisions"},
            )
        )

    return chunks


def chunk_transcript(meeting: Meeting, segments: list[TranscriptSegment]) -> list[Chunk]:
    if not segments:
        return []

    base_meta = _meeting_metadata(meeting)
    chunks: list[Chunk] = []
    current_lines: list[str] = []
    current_words = 0
    chunk_index = 0

    def flush():
        nonlocal current_lines, current_words, chunk_index
        if not current_lines:
            return
        chunks.append(
            Chunk(
                id=f"{meeting.id}:transcript:{chunk_index}",
                text="\n".join(current_lines),
                metadata={**base_meta, "chunk_type": "transcript"},
            )
        )
        chunk_index += 1
        current_lines = []
        current_words = 0

    for seg in segments:
        current_lines.append(f"[{seg.speaker_label}]: {seg.text}")
        current_words += len(seg.text.split())
        if current_words >= TRANSCRIPT_CHUNK_TARGET_WORDS:
            flush()
    flush()

    return chunks


def embed_meeting(meeting_id: int) -> int:
    """Chunk + embed + write one meeting's content into Chroma, replacing
    any chunks already there for it. Returns the number of chunks written.
    Raises EmbeddingError subclasses - never calls sys.exit(), safe to call
    from a web request."""
    session = SessionLocal()
    try:
        meeting = session.get(Meeting, meeting_id)
        if meeting is None:
            raise MeetingNotFoundError(f"no meeting with id={meeting_id} in the database.")

        summary = session.query(Summary).filter_by(meeting_id=meeting_id).one_or_none()
        segments = (
            session.query(TranscriptSegment)
            .filter_by(meeting_id=meeting_id)
            .order_by(TranscriptSegment.start_timestamp)
            .all()
        )
    finally:
        session.close()

    chunks = chunk_summary(meeting, summary) + chunk_transcript(meeting, segments)
    if not chunks:
        raise NoContentError(
            f"meeting id={meeting_id} has no summary and no transcript segments - nothing to embed."
        )

    model = get_model()
    vectors = model.encode([c.text for c in chunks], show_progress_bar=False).tolist()

    collection = get_collection()
    # Delete this meeting's old chunks first rather than upserting by id -
    # see module docstring for why a plain upsert isn't enough here.
    collection.delete(where={"meeting_id": meeting_id})
    collection.add(
        ids=[c.id for c in chunks],
        embeddings=vectors,
        documents=[c.text for c in chunks],
        metadatas=[c.metadata for c in chunks],
    )

    return len(chunks)


def embedded_meeting_ids() -> set[int]:
    """Which meeting_ids already have at least one chunk in Chroma."""
    collection = get_collection()
    if collection.count() == 0:
        return set()
    result = collection.get(include=["metadatas"])
    return {m["meeting_id"] for m in result["metadatas"]}


@dataclass
class EmbedAllSummary:
    embedded: list[tuple[int, int]] = field(default_factory=list)  # (meeting_id, chunks_written)
    already_embedded: list[int] = field(default_factory=list)
    skipped_no_content: list[int] = field(default_factory=list)


def embed_all(user_id: int | None = None) -> EmbedAllSummary:
    """Embed every meeting that doesn't already have chunks in Chroma.
    Meetings already embedded, or with nothing to embed, are reported
    separately rather than silently skipped.

    When user_id is given (the web POST /embed-all endpoint always passes
    the current user), only that user's own meetings are considered - one
    user's request should never cause the system to read, chunk, and embed
    another user's private meeting content. The CLI's --all flag omits it,
    for a trusted local operator embedding everything at once."""
    session = SessionLocal()
    try:
        query = session.query(Meeting.id)
        if user_id is not None:
            query = query.filter_by(user_id=user_id)
        all_ids = [m.id for m in query.all()]
    finally:
        session.close()

    already = embedded_meeting_ids()
    summary = EmbedAllSummary()
    for meeting_id in all_ids:
        if meeting_id in already:
            summary.already_embedded.append(meeting_id)
            continue
        try:
            count = embed_meeting(meeting_id)
            summary.embedded.append((meeting_id, count))
        except NoContentError:
            summary.skipped_no_content.append(meeting_id)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--meeting-id", type=int, help="Embed a single meeting (our own meetings.id)")
    group.add_argument("--all", action="store_true", help="Embed every meeting not yet embedded")
    args = parser.parse_args()

    if args.all:
        summary = embed_all()
        for meeting_id, count in summary.embedded:
            print(f"meeting_id={meeting_id}: {count} chunks written")
        if summary.already_embedded:
            print(f"Already embedded, skipped: {summary.already_embedded}")
        if summary.skipped_no_content:
            print(f"No summary/transcript yet, skipped: {summary.skipped_no_content}")
        if not summary.embedded and not summary.already_embedded and not summary.skipped_no_content:
            print("No meetings found.")
        return

    try:
        count = embed_meeting(args.meeting_id)
    except EmbeddingError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
    print(f"meeting_id={args.meeting_id}: {count} chunks written to Chroma.")


if __name__ == "__main__":
    main()

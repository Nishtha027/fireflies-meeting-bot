# Testing guidelines

## The rule

**Disposable test accounts used for verification MUST NEVER reference an
existing real user's `(platform, native_meeting_id)`.**

When a test genuinely needs real, playable audio, create a fresh, dedicated
throwaway call (e.g. a new Jitsi or Google Meet session created solely for
that test) and send a real bot to it, producing entirely new, isolated test
data. Never mirror or copy a real meeting's identifiers into test data,
under any circumstance.

This is not a style preference — it is mandatory, on the same footing as
the code-level protection in `_delete_meeting_fully()`
([backend/main.py](../backend/main.py)). Treat both as required; neither
one is a substitute for the other.

## The incident (2026-09-15)

While testing audio playback and chapter features, disposable QA accounts
were deliberately seeded with `Meeting` rows copying a real meeting's
`platform` + `native_meeting_id` (and `vexa_meeting_id`) — the point was to
get the disposable account's meeting to resolve to the *same* real,
already-recorded Vexa audio, so playback could be tested in a real browser
session without needing the real account's login credentials.

That reasoning missed a consequence: Vexa's own `DELETE
/meetings/{platform}/{native_meeting_id}` route has no concept of our
app's users at all. It deletes the recording (and transcript) for that
native meeting code **globally** — not scoped to whichever of our local
`Meeting` rows triggered the call. Once our own account/meeting-deletion
flow started calling that route on cleanup (added to fix a real orphaned-
recording leak), cleaning up a disposable test account that had been
mirrored onto a real meeting's `native_meeting_id` cascaded a real Vexa-side
delete — destroying that real recording permanently, even though the real
meeting itself was never touched locally.

Two real recordings were destroyed this way (our own meetings id=2 and
id=18, both owned by the same real account). Confirmed via Vexa's own
audit trail (`meetings.data->'artifact_deletion'` in Vexa's Postgres
database), which is unambiguous: this was a genuine, deliberate deletion
Vexa executed on request — not data corruption, not a storage/Docker
issue. Recovery was not possible; nothing was restored.

## Why the code fix alone isn't enough

[backend/main.py](../backend/main.py)'s `_delete_meeting_fully()` now
checks whether any other local `Meeting` row (any user) still references
the same `(platform, native_meeting_id)` before calling Vexa's
delete-by-native-key, and skips that call if one does. This protects any
recording that is *currently* mirrored by more than one local row at the
moment of deletion.

It does **not** protect a recording once every local row that shared it has
been deleted — which is exactly what happens at the end of a normal QA
cycle: the disposable account's mirror gets cleaned up, and depending on
timing, may be the only reference left by the time it goes. The code fix
closes the "delete while shared" window; it does not make mirroring safe.
The only reliable protection is to never create the shared reference in
the first place — hence this rule.

## What to do instead

- Need to verify a UI feature that requires real playable audio? Send a
  real bot to a **fresh** throwaway meeting created solely for that test
  (a new Jitsi room, e.g. `https://meet.ffmuc.net/<unique-test-name>`, or a
  new ad hoc Google Meet call), via `capture_meeting.start_capture()` /
  the app's own "Capture Meeting" flow. That produces new, fully isolated
  Vexa data with no other local or remote owner.
- Need a disposable account for UI/session testing? Give it its own
  freshly-captured meetings, never another user's.
- When the disposable account/meeting is deleted at the end of the test,
  its Vexa-side recording is deleted too (by design) — and since nothing
  else ever referenced it, that's correct and harmless.

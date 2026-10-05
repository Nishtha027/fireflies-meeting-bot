"""
A small in-memory sliding-window limiter for FAILED attempts on the public
auth endpoints (/auth/login, /auth/register).

Why it exists: once the app is reachable from the internet, the shared invite
code and user passwords are guessable by anyone willing to loop over the API.
Capping failed attempts turns that from "minutes" into "weeks".

Scope and limits, on purpose:
- State is per worker process (production runs several uvicorn workers), so
  the effective cap is up to N_WORKERS x the configured value. That is still
  a hard ceiling; a shared store (Redis/Postgres) would make it exact but is
  more moving parts than this app needs.
- State resets on restart. An attacker can't trigger restarts, so this only
  forgives the occasional legitimate user.
- Only failures count, and a success clears that key, so normal use never
  hits a limit.
"""

import threading
import time
from collections import deque

# Bound on distinct keys held at once, so a flood of unique emails/IPs can't
# be used to exhaust memory.
_MAX_KEYS = 10_000


class FailureLimiter:
    def __init__(self, max_failures: int, window_seconds: int):
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self._events: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _trim(self, key: str, now: float) -> deque[float] | None:
        events = self._events.get(key)
        if events is None:
            return None
        cutoff = now - self.window_seconds
        while events and events[0] <= cutoff:
            events.popleft()
        if not events:
            del self._events[key]
            return None
        return events

    def retry_after(self, key: str) -> int:
        """Seconds until `key` may try again; 0 if it isn't blocked."""
        now = time.monotonic()
        with self._lock:
            events = self._trim(key, now)
            if events is None or len(events) < self.max_failures:
                return 0
            return max(1, int(events[0] + self.window_seconds - now) + 1)

    def record_failure(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            events = self._trim(key, now)
            if events is None:
                if len(self._events) >= _MAX_KEYS:
                    # Evict the oldest-inserted key rather than grow forever.
                    self._events.pop(next(iter(self._events)))
                events = self._events[key] = deque()
            events.append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._events.pop(key, None)

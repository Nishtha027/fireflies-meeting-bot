/** Statuses a capture will never leave - matches backend/poller.py's
 * TERMINAL_STATUSES. Once a meeting reaches one of these, nothing should
 * keep checking it. */
export const TERMINAL_CAPTURE_STATUSES = new Set(["completed", "failed"]);

export function isTerminalCaptureStatus(status: string): boolean {
  return TERMINAL_CAPTURE_STATUSES.has(status);
}

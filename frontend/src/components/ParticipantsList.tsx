"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { ApiError, NetworkError, renameParticipant } from "@/lib/api";
import type { ParticipantRenameResponse } from "@/lib/types";

/** One control per unique participant name (not per transcript line) - a
 * meeting-wide rename, reusing the same click-to-edit pattern as the
 * meeting title (EditableTitle in the meeting detail page). */
function ParticipantRow({
  meetingId,
  name,
  onRenamed,
}: {
  meetingId: number;
  name: string;
  onRenamed: (result: ParticipantRenameResponse) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setDraft(name);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await renameParticipant(meetingId, name, trimmed);
      onRenamed(result);
      setEditing(false);
    } catch (err) {
      if (err instanceof NetworkError || err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Something went wrong renaming this participant.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="group flex items-center gap-1.5">
        <span className="truncate text-xs text-foreground">{name}</span>
        <button
          type="button"
          onClick={startEditing}
          aria-label={`Rename ${name}`}
          title="Rename in this meeting"
          className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
          autoFocus
          disabled={saving}
          className="w-full min-w-0 rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground focus:border-indigo-300 focus:bg-card focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          aria-label="Save name"
          title="Save"
          className="flex-shrink-0 rounded p-1 text-emerald-600 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
        >
          <Check className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          aria-label="Cancel renaming"
          title="Cancel"
          className="flex-shrink-0 rounded p-1 text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

export function ParticipantsList({
  meetingId,
  participants,
  onRenamed,
}: {
  meetingId: number;
  participants: string[];
  onRenamed: (result: ParticipantRenameResponse) => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);

  function handleRenamed(result: ParticipantRenameResponse) {
    setNotice(
      result.merged
        ? `Merged into existing participant "${result.new_name}".`
        : `Renamed "${result.old_name}" to "${result.new_name}".`,
    );
    onRenamed(result);
  }

  if (participants.length === 0) return null;

  return (
    <div className="mt-3 space-y-1">
      {participants.map((name) => (
        <ParticipantRow
          key={name}
          meetingId={meetingId}
          name={name}
          onRenamed={handleRenamed}
        />
      ))}
      {notice && <p className="mt-1 text-xs text-muted-foreground">{notice}</p>}
    </div>
  );
}

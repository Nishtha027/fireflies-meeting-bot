"use client";

import { useEffect, useState } from "react";
import { getParticipants } from "@/lib/api";

/** Populates itself from GET /meetings/participants (already scoped to the
 * current user's own meetings server-side) - fails silently into "no
 * options besides All" rather than blocking the rest of the search page on
 * a secondary filter. */
export function ParticipantFilter({
  participant,
  onChange,
}: {
  participant: string;
  onChange: (participant: string) => void;
}) {
  const [options, setOptions] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getParticipants()
      .then((data) => {
        if (!cancelled) setOptions(data);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (options !== null && options.length === 0 && !participant) return null;

  return (
    <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
      Participant
      <select
        value={participant}
        onChange={(e) => onChange(e.target.value)}
        disabled={options === null}
        className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">All participants</option>
        {(options ?? []).map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

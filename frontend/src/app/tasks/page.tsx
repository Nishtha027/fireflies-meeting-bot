"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ApiError,
  getActionItems,
  NetworkError,
  updateActionItem,
} from "@/lib/api";
import type { ActionItemWithMeeting } from "@/lib/types";
import { formatDateTime, meetingTitle } from "@/lib/format";
import { ErrorState } from "@/components/ErrorState";

const UNASSIGNED = "Unassigned";

type StatusFilter = "all" | "open" | "completed";

function TasksSkeleton() {
  return (
    <div className="animate-pulse divide-y divide-border rounded-xl border border-border bg-card">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <div className="h-3 flex-1 rounded bg-muted" />
          <div className="h-3 w-20 rounded bg-muted" />
          <div className="h-3 w-32 rounded bg-muted" />
          <div className="h-3 w-24 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function EmptyTasksState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted px-6 py-16 text-center">
      <p className="text-base font-semibold text-foreground">
        No action items yet
      </p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Once a meeting is summarized, any action items it generates will show
        up here.
      </p>
    </div>
  );
}

function NoMatchesState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted px-6 py-16 text-center">
      <p className="text-base font-semibold text-foreground">
        No tasks match these filters
      </p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Try a different assignee or status filter.
      </p>
    </div>
  );
}

interface MeetingGroup {
  meetingId: number;
  meetingTitle: string | null;
  platform: string;
  nativeMeetingId: string;
  meetingStartTime: string | null;
  items: ActionItemWithMeeting[];
}

function TaskRow({
  item,
  onToggle,
}: {
  item: ActionItemWithMeeting;
  onToggle: (item: ActionItemWithMeeting) => void;
}) {
  return (
    <tr className={item.completed ? "bg-muted/60" : undefined}>
      <td className="w-10 px-5 py-4">
        <input
          type="checkbox"
          checked={item.completed}
          onChange={() => onToggle(item)}
          aria-label={
            item.completed
              ? `Mark "${item.description}" as open`
              : `Mark "${item.description}" as completed`
          }
          className="h-4 w-4 rounded border-border text-indigo-600 focus:ring-indigo-500"
        />
      </td>
      <td
        className={`max-w-md px-5 py-4 ${
          item.completed ? "text-muted-foreground line-through" : "text-foreground"
        }`}
      >
        {item.description}
      </td>
      <td className={`px-5 py-4 ${item.completed ? "text-muted-foreground" : "text-muted-foreground"}`}>
        {item.assignee_guess ?? (
          <span className="italic text-muted-foreground">{UNASSIGNED}</span>
        )}
      </td>
      <td
        className={`whitespace-nowrap px-5 py-4 ${
          item.completed ? "text-muted-foreground" : "text-muted-foreground"
        }`}
      >
        {formatDateTime(item.generated_at)}
      </td>
    </tr>
  );
}

function MeetingGroupSection({
  group,
  onToggle,
}: {
  group: MeetingGroup;
  onToggle: (item: ActionItemWithMeeting) => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-5 py-3">
        <Link
          href={`/meetings/${group.meetingId}`}
          className="font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          {meetingTitle(group.meetingTitle, group.platform, group.nativeMeetingId)}
        </Link>
        <span className="text-sm text-muted-foreground">
          {formatDateTime(group.meetingStartTime)}
        </span>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="w-10 px-5 py-3" />
            <th className="px-5 py-3 font-medium">Task</th>
            <th className="px-5 py-3 font-medium">Assignee</th>
            <th className="px-5 py-3 font-medium">Generated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {group.items.map((item) => (
            <TaskRow key={item.id} item={item} onToggle={onToggle} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function TasksPage() {
  const [items, setItems] = useState<ActionItemWithMeeting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getActionItems()
      .then((data) => {
        if (!cancelled) setItems(data);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof NetworkError) {
          setError(err.message);
        } else if (err instanceof ApiError) {
          setError(`The server returned an error: ${err.message}`);
        } else {
          setError("Something went wrong loading tasks.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const retry = () => {
    setError(null);
    setItems(null);
    setReloadToken((t) => t + 1);
  };

  async function toggleCompleted(item: ActionItemWithMeeting) {
    const nextCompleted = !item.completed;

    // Optimistic update: flip the checkbox immediately, revert only if the
    // API call actually fails.
    setItems(
      (prev) =>
        prev?.map((i) =>
          i.id === item.id ? { ...i, completed: nextCompleted } : i,
        ) ?? prev,
    );

    try {
      await updateActionItem(item.id, { completed: nextCompleted });
    } catch {
      setItems(
        (prev) =>
          prev?.map((i) =>
            i.id === item.id ? { ...i, completed: item.completed } : i,
          ) ?? prev,
      );
    }
  }

  const assignees = useMemo(() => {
    if (!items) return [];
    const names = new Set(items.map((item) => item.assignee_guess ?? UNASSIGNED));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filteredItems = useMemo(() => {
    if (!items) return [];
    return items.filter((item) => {
      if (assigneeFilter !== "all" && (item.assignee_guess ?? UNASSIGNED) !== assigneeFilter) {
        return false;
      }
      if (statusFilter === "open" && item.completed) return false;
      if (statusFilter === "completed" && !item.completed) return false;
      return true;
    });
  }, [items, assigneeFilter, statusFilter]);

  // Grouped from the already-filtered list, so a meeting whose tasks were
  // all filtered out simply never gets a group (no empty-header case to
  // handle), and a meeting with zero tasks to begin with never appears here
  // at all, since it can't contribute any items in the first place.
  const groups = useMemo<MeetingGroup[]>(() => {
    const byMeeting = new Map<number, MeetingGroup>();
    for (const item of filteredItems) {
      let group = byMeeting.get(item.meeting_id);
      if (!group) {
        group = {
          meetingId: item.meeting_id,
          meetingTitle: item.meeting_title,
          platform: item.platform,
          nativeMeetingId: item.native_meeting_id,
          meetingStartTime: item.meeting_start_time,
          items: [],
        };
        byMeeting.set(item.meeting_id, group);
      }
      group.items.push(item);
    }
    return Array.from(byMeeting.values()).sort((a, b) => {
      const aTime = a.meetingStartTime ? new Date(a.meetingStartTime).getTime() : -Infinity;
      const bTime = b.meetingStartTime ? new Date(b.meetingStartTime).getTime() : -Infinity;
      return bTime - aTime;
    });
  }, [filteredItems]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Tasks
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every action item across every meeting, in one place.
          </p>
        </div>

        {items !== null && items.length > 0 && (
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Status
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground"
              >
                <option value="all">All</option>
                <option value="open">Open</option>
                <option value="completed">Completed</option>
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Assignee
              <select
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground"
              >
                <option value="all">All assignees</option>
                {assignees.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {error && <ErrorState message={error} onRetry={retry} />}

      {!error && items === null && <TasksSkeleton />}

      {!error && items !== null && items.length === 0 && <EmptyTasksState />}

      {!error && items !== null && items.length > 0 && filteredItems.length === 0 && (
        <NoMatchesState />
      )}

      {!error && items !== null && filteredItems.length > 0 && (
        <div className="space-y-6">
          {groups.map((group) => (
            <MeetingGroupSection
              key={group.meetingId}
              group={group}
              onToggle={toggleCompleted}
            />
          ))}
        </div>
      )}
    </main>
  );
}

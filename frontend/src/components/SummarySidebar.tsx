"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  ApiError,
  createActionItem,
  deleteActionItem,
  NetworkError,
  updateActionItem,
} from "@/lib/api";
import type { ActionItem, Summary } from "@/lib/types";
import { ChaptersList } from "./ChaptersList";

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof NetworkError || err instanceof ApiError) return err.message;
  return fallback;
}

function BulletList({ items, emptyLabel }: { items: string[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <p className="text-sm italic text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm text-foreground">
          <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-muted-foreground" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

const inlineInputClass =
  "w-full rounded-lg border border-border bg-card px-2 py-1 text-sm text-foreground focus:border-indigo-300 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60";

/** One action item row - either its normal display (checkbox + text +
 * pencil/trash affordances) or, while editing, an inline description/
 * assignee form in place - same click-to-edit feel as the meeting title
 * (see EditableTitle in the meeting detail page). Works identically for a
 * manually-added item and an AI-generated one - nothing here branches on
 * origin. */
function ActionItemRow({
  item,
  onToggle,
  onSave,
  onDelete,
}: {
  item: ActionItem;
  onToggle: (item: ActionItem) => void;
  onSave: (item: ActionItem, description: string, assigneeGuess: string | null) => Promise<void>;
  onDelete: (item: ActionItem) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(item.description);
  const [assignee, setAssignee] = useState(item.assignee_guess ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function startEditing() {
    setDescription(item.description);
    setAssignee(item.assignee_guess ?? "");
    setError(null);
    setEditing(true);
  }

  async function save() {
    const trimmed = description.trim();
    if (!trimmed) {
      setError("Description can't be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(item, trimmed, assignee.trim() || null);
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err, "Something went wrong saving this task."));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(item);
    } catch (err) {
      setDeleteError(errorMessage(err, "Something went wrong deleting this task."));
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <li className="rounded-lg border border-border bg-muted p-2.5">
        <div className="space-y-1.5">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            autoFocus
            disabled={saving}
            className={inlineInputClass}
          />
          <input
            type="text"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder="Assignee (optional)"
            disabled={saving}
            className={`${inlineInputClass} text-xs`}
          />
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-1">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              aria-label="Save task"
              title="Save"
              className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              aria-label="Cancel editing task"
              title="Cancel"
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-card disabled:cursor-not-allowed disabled:opacity-60"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-border bg-muted p-2.5">
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={item.completed}
          onChange={() => onToggle(item)}
          aria-label={
            item.completed
              ? `Mark "${item.description}" as open`
              : `Mark "${item.description}" as completed`
          }
          className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-border text-indigo-600 focus:ring-indigo-500"
        />
        <div className="min-w-0 flex-1 text-sm">
          <p className={item.completed ? "text-muted-foreground line-through" : "text-foreground"}>
            {item.description}
          </p>
          {item.assignee_guess && (
            <p className="mt-0.5 text-xs font-medium text-indigo-600 dark:text-indigo-400">
              {item.assignee_guess}
            </p>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={startEditing}
            aria-label="Edit task"
            title="Edit task"
            className="rounded-lg p-1 text-muted-foreground hover:bg-card hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setDeleteError(null);
              setConfirmingDelete(true);
            }}
            aria-label="Delete task"
            title="Delete task"
            className="rounded-lg p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {confirmingDelete && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 dark:border-red-900 dark:bg-red-950/30">
          <span className="text-xs text-red-700 dark:text-red-300">Delete this task?</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleting}
              className="text-xs font-medium text-red-700 hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-300"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
              className="text-xs text-muted-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {deleteError && (
        <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{deleteError}</p>
      )}
    </li>
  );
}

/** The "+ Add task" control - an inline form in place of a modal, matching
 * EditableTitle's lightweight feel (see the meeting detail page). */
function AddActionItemForm({ onAdd }: { onAdd: (description: string, assigneeGuess: string | null) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() {
    setDescription("");
    setAssignee("");
    setError(null);
    setOpen(true);
  }

  async function save() {
    const trimmed = description.trim();
    if (!trimmed) {
      setError("Description can't be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onAdd(trimmed, assignee.trim() || null);
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err, "Something went wrong adding this task."));
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={start}
        className="mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/30"
      >
        <Plus className="h-3.5 w-3.5" />
        Add task
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-border bg-muted p-2.5">
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Task description"
        autoFocus
        disabled={saving}
        className={inlineInputClass}
      />
      <input
        type="text"
        value={assignee}
        onChange={(e) => setAssignee(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Assignee (optional)"
        disabled={saving}
        className={`${inlineInputClass} text-xs`}
      />
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-1">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          aria-label="Add task"
          title="Add"
          className="rounded-lg p-1.5 text-emerald-600 hover:bg-card disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-400"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={saving}
          aria-label="Cancel adding task"
          title="Cancel"
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-card disabled:cursor-not-allowed disabled:opacity-60"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function ActionItemsPanel({
  meetingId,
  items,
  onItemsChange,
}: {
  meetingId: number;
  items: ActionItem[];
  onItemsChange: (items: ActionItem[]) => void;
}) {
  async function toggleCompleted(item: ActionItem) {
    const nextCompleted = !item.completed;
    // Optimistic, same pattern as the Tasks page's checkbox.
    onItemsChange(items.map((i) => (i.id === item.id ? { ...i, completed: nextCompleted } : i)));
    try {
      await updateActionItem(item.id, { completed: nextCompleted });
    } catch {
      onItemsChange(items.map((i) => (i.id === item.id ? { ...i, completed: item.completed } : i)));
    }
  }

  async function saveEdit(item: ActionItem, description: string, assigneeGuess: string | null) {
    const updated = await updateActionItem(item.id, {
      description,
      assignee_guess: assigneeGuess,
    });
    onItemsChange(
      items.map((i) =>
        i.id === item.id
          ? {
              id: updated.id,
              description: updated.description,
              assignee_guess: updated.assignee_guess,
              completed: updated.completed,
            }
          : i,
      ),
    );
  }

  async function removeItem(item: ActionItem) {
    await deleteActionItem(item.id);
    onItemsChange(items.filter((i) => i.id !== item.id));
  }

  async function addItem(description: string, assigneeGuess: string | null) {
    const created = await createActionItem(meetingId, description, assigneeGuess);
    onItemsChange([...items, created]);
  }

  return (
    <div>
      {items.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">No action items recorded.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <ActionItemRow
              key={item.id}
              item={item}
              onToggle={toggleCompleted}
              onSave={saveEdit}
              onDelete={removeItem}
            />
          ))}
        </ul>
      )}
      <AddActionItemForm onAdd={addItem} />
    </div>
  );
}

export function SummaryPanelContent({
  meetingId,
  summary,
  actionItems,
  onActionItemsChange,
  activeChapterIndex = null,
  onChapterClick,
}: {
  meetingId: number;
  summary: Summary;
  actionItems: ActionItem[];
  /** Reports the new array back up so the page's `meeting.action_items`
   * stays in sync - same lifted-state pattern as EditableTitle's onSaved. */
  onActionItemsChange: (items: ActionItem[]) => void;
  /** The chapter whose start_time_seconds is at-or-before the audio
   * player's current playback position - null when nothing is playing. */
  activeChapterIndex?: number | null;
  /** Click-to-seek: fired with a chapter's index when one is clicked. */
  onChapterClick?: (index: number) => void;
}) {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Chapters</h3>
        <ChaptersList
          chapters={summary.chapters}
          activeIndex={activeChapterIndex}
          onChapterClick={onChapterClick}
        />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Overview</h3>
        <p className="text-sm leading-relaxed text-foreground">
          {summary.overview_text}
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Key points</h3>
        <BulletList items={summary.key_points} emptyLabel="No key points recorded." />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Decisions</h3>
        <BulletList items={summary.decisions} emptyLabel="No decisions recorded." />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Action items</h3>
        <ActionItemsPanel
          meetingId={meetingId}
          items={actionItems}
          onItemsChange={onActionItemsChange}
        />
      </section>
    </div>
  );
}

export function SidebarSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i}>
          <div className="mb-2 h-3 w-20 rounded bg-muted" />
          <div className="h-3 w-full rounded bg-muted" />
          <div className="mt-2 h-3 w-2/3 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

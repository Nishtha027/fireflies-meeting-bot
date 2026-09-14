import { formatStatusLabel } from "@/lib/format";

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  active: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  error: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  // Vexa's live bot-lifecycle states (see docs/api/meetings#meeting-statuses) -
  // shown while a "Capture Meeting" bot is on its way to/in a call.
  requested: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  joining: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  awaiting_admission: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  needs_help: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  stopping: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}
    >
      {formatStatusLabel(status)}
    </span>
  );
}

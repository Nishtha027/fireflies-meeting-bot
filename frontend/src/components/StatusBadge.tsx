import { formatStatusLabel } from "@/lib/format";

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700",
  active: "bg-blue-100 text-blue-700",
  failed: "bg-red-100 text-red-700",
  error: "bg-red-100 text-red-700",
  // Vexa's live bot-lifecycle states (see docs/api/meetings#meeting-statuses) -
  // shown while a "Capture Meeting" bot is on its way to/in a call.
  requested: "bg-indigo-100 text-indigo-700",
  joining: "bg-sky-100 text-sky-700",
  awaiting_admission: "bg-amber-100 text-amber-700",
  needs_help: "bg-orange-100 text-orange-700",
  stopping: "bg-slate-100 text-slate-600",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600";
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}
    >
      {formatStatusLabel(status)}
    </span>
  );
}

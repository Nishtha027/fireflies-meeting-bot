// Local calendar date as "YYYY-MM-DD" - NOT toISOString(), which converts
// to UTC first and can shift the date by a day depending on the viewer's
// timezone (e.g. local midnight Sept 1 becomes Aug 31 in UTC west of it).
function toDateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek(): Date {
  const now = new Date();
  const dayOfWeek = (now.getDay() + 6) % 7; // 0 = Monday
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(now.getDate() - dayOfWeek);
  return start;
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function DateRangeFilter({
  fromDate,
  toDate,
  onChange,
}: {
  fromDate: string;
  toDate: string;
  onChange: (range: { fromDate: string; toDate: string }) => void;
}) {
  const hasRange = fromDate !== "" || toDate !== "";
  const today = toDateString(new Date());

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        From
        <input
          type="date"
          value={fromDate}
          onChange={(e) => onChange({ fromDate: e.target.value, toDate })}
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground"
        />
      </label>
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        To
        <input
          type="date"
          value={toDate}
          onChange={(e) => onChange({ fromDate, toDate: e.target.value })}
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground"
        />
      </label>

      <div className="mx-1 h-5 w-px bg-border" aria-hidden />

      <button
        type="button"
        onClick={() => onChange({ fromDate: toDateString(startOfWeek()), toDate: today })}
        className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
      >
        This week
      </button>
      <button
        type="button"
        onClick={() => onChange({ fromDate: toDateString(startOfMonth()), toDate: today })}
        className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
      >
        This month
      </button>

      {hasRange && (
        <button
          type="button"
          onClick={() => onChange({ fromDate: "", toDate: "" })}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          Clear dates
        </button>
      )}
    </div>
  );
}

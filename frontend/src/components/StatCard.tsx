export function StatCard({
  label,
  value,
  caption,
}: {
  label: string;
  value: number | string | null;
  caption?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 truncate text-3xl font-semibold tracking-tight text-slate-900">
        {value === null ? (
          <span className="inline-block h-8 w-12 animate-pulse rounded bg-slate-200 align-middle" />
        ) : (
          value
        )}
      </p>
      {value !== null && caption && (
        <p className="mt-0.5 text-sm text-slate-500">{caption}</p>
      )}
    </div>
  );
}

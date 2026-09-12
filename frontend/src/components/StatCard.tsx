export function StatCard({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
        {value === null ? (
          <span className="inline-block h-8 w-12 animate-pulse rounded bg-slate-200 align-middle" />
        ) : (
          value
        )}
      </p>
    </div>
  );
}

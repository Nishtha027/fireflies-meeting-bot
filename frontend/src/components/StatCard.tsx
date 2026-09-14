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
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-3xl font-semibold tracking-tight text-foreground">
        {value === null ? (
          <span className="inline-block h-8 w-12 animate-pulse rounded bg-muted align-middle" />
        ) : (
          value
        )}
      </p>
      {value !== null && caption && (
        <p className="mt-0.5 text-sm text-muted-foreground">{caption}</p>
      )}
    </div>
  );
}

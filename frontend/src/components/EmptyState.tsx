export function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-muted px-6 py-16 text-center">
      <p className="text-base font-semibold text-foreground">
        No meetings yet
      </p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Once a meeting bot joins and finishes recording, it&apos;ll show up
        here automatically.
      </p>
    </div>
  );
}

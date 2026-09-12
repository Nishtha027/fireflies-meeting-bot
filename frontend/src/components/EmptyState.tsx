export function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center">
      <p className="text-base font-semibold text-slate-700">
        No meetings yet
      </p>
      <p className="max-w-sm text-sm text-slate-500">
        Once a meeting bot joins and finishes recording, it&apos;ll show up
        here automatically.
      </p>
    </div>
  );
}

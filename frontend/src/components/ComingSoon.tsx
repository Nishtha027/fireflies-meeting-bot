import type { ComponentType } from "react";

export function ComingSoon({
  icon: Icon,
  title,
  description,
  phaseLabel,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  phaseLabel: string;
}) {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
      <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-20 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
          <Icon className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-2 max-w-md text-sm text-slate-500">{description}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-500">
          {phaseLabel}
        </span>
      </div>
    </main>
  );
}

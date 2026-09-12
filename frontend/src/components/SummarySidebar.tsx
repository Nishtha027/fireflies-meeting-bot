import type { ActionItem, Summary } from "@/lib/types";

function BulletList({ items, emptyLabel }: { items: string[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <p className="text-sm italic text-slate-400">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm text-slate-700">
          <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-slate-400" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function ActionItemsList({ items }: { items: ActionItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm italic text-slate-400">No action items recorded.</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li
          key={i}
          className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5"
        >
          <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border border-slate-300 bg-white" />
          <div className="min-w-0 text-sm">
            <p className="text-slate-800">{item.description}</p>
            {item.assignee_guess && (
              <p className="mt-0.5 text-xs font-medium text-indigo-600">
                {item.assignee_guess}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SummaryPanelContent({
  summary,
  actionItems,
}: {
  summary: Summary;
  actionItems: ActionItem[];
}) {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Overview</h3>
        <p className="text-sm leading-relaxed text-slate-700">
          {summary.overview_text}
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Key points</h3>
        <BulletList items={summary.key_points} emptyLabel="No key points recorded." />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Decisions</h3>
        <BulletList items={summary.decisions} emptyLabel="No decisions recorded." />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Action items</h3>
        <ActionItemsList items={actionItems} />
      </section>
    </div>
  );
}

export function SidebarSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i}>
          <div className="mb-2 h-3 w-20 rounded bg-slate-200" />
          <div className="h-3 w-full rounded bg-slate-100" />
          <div className="mt-2 h-3 w-2/3 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

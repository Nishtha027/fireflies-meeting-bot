import type { ActionItem, Summary } from "@/lib/types";
import { ChaptersList } from "./ChaptersList";

function BulletList({ items, emptyLabel }: { items: string[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <p className="text-sm italic text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm text-foreground">
          <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-muted-foreground" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function ActionItemsList({ items }: { items: ActionItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm italic text-muted-foreground">No action items recorded.</p>;
  }
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li
          key={i}
          className="flex items-start gap-2.5 rounded-lg border border-border bg-muted p-2.5"
        >
          <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border border-border bg-card" />
          <div className="min-w-0 text-sm">
            <p className="text-foreground">{item.description}</p>
            {item.assignee_guess && (
              <p className="mt-0.5 text-xs font-medium text-indigo-600 dark:text-indigo-400">
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
  activeChapterIndex = null,
  onChapterClick,
}: {
  summary: Summary;
  actionItems: ActionItem[];
  /** The chapter whose start_time_seconds is at-or-before the audio
   * player's current playback position - null when nothing is playing. */
  activeChapterIndex?: number | null;
  /** Click-to-seek: fired with a chapter's index when one is clicked. */
  onChapterClick?: (index: number) => void;
}) {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Chapters</h3>
        <ChaptersList
          chapters={summary.chapters}
          activeIndex={activeChapterIndex}
          onChapterClick={onChapterClick}
        />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Overview</h3>
        <p className="text-sm leading-relaxed text-foreground">
          {summary.overview_text}
        </p>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Key points</h3>
        <BulletList items={summary.key_points} emptyLabel="No key points recorded." />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Decisions</h3>
        <BulletList items={summary.decisions} emptyLabel="No decisions recorded." />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Action items</h3>
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
          <div className="mb-2 h-3 w-20 rounded bg-muted" />
          <div className="h-3 w-full rounded bg-muted" />
          <div className="mt-2 h-3 w-2/3 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

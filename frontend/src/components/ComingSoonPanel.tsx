import type { ComponentType } from "react";

export function ComingSoonPanel({
  icon: Icon,
  message,
  compact,
}: {
  icon: ComponentType<{ className?: string }>;
  message: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted text-center ${
        compact ? "px-6 py-10" : "px-6 py-16"
      }`}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-border text-muted-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm font-semibold text-foreground">Coming soon</p>
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

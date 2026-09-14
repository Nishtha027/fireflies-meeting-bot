"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import type { TooltipContentProps } from "recharts/types/component/Tooltip";
import type { SpeakerTalkTime } from "@/lib/types";
import { speakerHexColor } from "@/lib/speakerColor";

/** recharts renders SVG attributes, not Tailwind classes - `dark:` can't
 * reach them, so the couple of colors that touch the chart itself (axis
 * tick text, the hover cursor band) are resolved from the actual active
 * theme instead. Mirrors the mounted-guard the Settings page's theme
 * toggle uses, to avoid a server/client mismatch on first paint. */
function useIsDarkMode(): boolean {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && resolvedTheme === "dark";
}

function formatSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const secs = clamped % 60;
  if (minutes === 0) return `${secs}s`;
  return `${minutes}m ${secs}s`;
}

function TalkTimeTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload as SpeakerTalkTime;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-foreground">{point.speaker_label}</p>
      <p className="text-muted-foreground">
        {formatSeconds(point.talk_time_seconds)} &middot; {point.percentage.toFixed(0)}%
      </p>
    </div>
  );
}

function NoSpeakerData({ compact }: { compact?: boolean }) {
  return (
    <p
      className={`text-center italic text-muted-foreground ${compact ? "py-4 text-xs" : "py-8 text-sm"}`}
    >
      No speaker data yet.
    </p>
  );
}

/** Full-size talk-time breakdown: a pie chart plus a legend with exact
 * seconds/percentage, used on the Analytics page's per-meeting view. */
export function TalkTimePieChart({ speakers }: { speakers: SpeakerTalkTime[] }) {
  if (speakers.length === 0) return <NoSpeakerData />;

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-center">
      <div style={{ width: 200, height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={speakers}
              dataKey="talk_time_seconds"
              nameKey="speaker_label"
              innerRadius={55}
              outerRadius={95}
              paddingAngle={speakers.length > 1 ? 2 : 0}
              stroke="none"
            >
              {speakers.map((s) => (
                <Cell key={s.speaker_label} fill={speakerHexColor(s.speaker_label)} />
              ))}
            </Pie>
            <Tooltip content={TalkTimeTooltip} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="flex flex-col gap-2.5">
        {speakers.map((s) => (
          <li key={s.speaker_label} className="flex items-center gap-2 text-sm">
            <span
              className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
              style={{ backgroundColor: speakerHexColor(s.speaker_label) }}
              aria-hidden
            />
            <span className="font-medium text-foreground">{s.speaker_label}</span>
            <span className="text-muted-foreground">
              {s.percentage.toFixed(0)}% &middot; {formatSeconds(s.talk_time_seconds)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Compact horizontal bar chart for the meeting detail sidebar - small
 * footprint, no legend/axis clutter, just bars sized by talk time. */
export function TalkTimeBarChart({ speakers }: { speakers: SpeakerTalkTime[] }) {
  const isDark = useIsDarkMode();
  if (speakers.length === 0) return <NoSpeakerData compact />;

  return (
    <ResponsiveContainer width="100%" height={Math.max(56, speakers.length * 30)}>
      <BarChart
        data={speakers}
        layout="vertical"
        margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
      >
        <XAxis type="number" hide domain={[0, "dataMax"]} />
        <YAxis
          type="category"
          dataKey="speaker_label"
          width={104}
          tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#475569" }}
          tickLine={false}
          axisLine={false}
          interval={0}
        />
        <Tooltip
          content={TalkTimeTooltip}
          cursor={{ fill: isDark ? "#1c2536" : "#f8fafc" }}
        />
        <Bar dataKey="talk_time_seconds" radius={[0, 3, 3, 0]} barSize={12}>
          {speakers.map((s) => (
            <Cell key={s.speaker_label} fill={speakerHexColor(s.speaker_label)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

"use client";

import { useState } from "react";
import { CalendarClock, ChevronRight, UploadCloud, Video } from "lucide-react";
import type { ComponentType } from "react";
import { CaptureMeetingModal } from "./CaptureMeetingModal";
import { Modal } from "./Modal";
import { ComingSoonPanel } from "./ComingSoonPanel";

type AccentColor = "indigo" | "sky" | "amber";

const ACCENT_CLASSES: Record<AccentColor, { bg: string; text: string; hover: string }> = {
  indigo: {
    bg: "bg-indigo-100 dark:bg-indigo-500/15",
    text: "text-indigo-600 dark:text-indigo-300",
    hover: "hover:border-indigo-300 dark:hover:border-indigo-500/60",
  },
  sky: {
    bg: "bg-sky-100 dark:bg-sky-500/15",
    text: "text-sky-600 dark:text-sky-300",
    hover: "hover:border-sky-300 dark:hover:border-sky-500/60",
  },
  amber: {
    bg: "bg-amber-100 dark:bg-amber-500/15",
    text: "text-amber-600 dark:text-amber-300",
    hover: "hover:border-amber-300 dark:hover:border-amber-500/60",
  },
};

interface QuickStartCardConfig {
  key: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  accent: AccentColor;
  onClick: () => void;
}

function QuickStartCard({
  label,
  description,
  icon: Icon,
  accent,
  onClick,
}: Omit<QuickStartCardConfig, "key">) {
  const colors = ACCENT_CLASSES[accent];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3.5 rounded-xl border border-border bg-card p-4 text-left transition hover:shadow-md ${colors.hover}`}
    >
      <span
        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${colors.bg} ${colors.text}`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">
          {label}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
    </button>
  );
}

export function QuickStart() {
  const [openModal, setOpenModal] = useState<
    "capture" | "schedule" | "upload" | null
  >(null);

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">Quick Start</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Start a new recording or catch up on recent meetings.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <QuickStartCard
          label="Capture Meeting"
          description="Send a bot into a Google Meet call"
          icon={Video}
          accent="indigo"
          onClick={() => setOpenModal("capture")}
        />
        <QuickStartCard
          label="Schedule Meeting"
          description="Auto-record from your calendar"
          icon={CalendarClock}
          accent="sky"
          onClick={() => setOpenModal("schedule")}
        />
        <QuickStartCard
          label="Upload File"
          description="Transcribe an existing recording"
          icon={UploadCloud}
          accent="amber"
          onClick={() => setOpenModal("upload")}
        />
      </div>

      {openModal === "capture" && (
        <CaptureMeetingModal onClose={() => setOpenModal(null)} />
      )}

      {openModal === "schedule" && (
        <Modal title="Schedule Meeting" onClose={() => setOpenModal(null)}>
          <ComingSoonPanel
            icon={CalendarClock}
            message="Connect your calendar to schedule automatic recordings. This is planned for a future update."
          />
        </Modal>
      )}

      {openModal === "upload" && (
        <Modal title="Upload File" onClose={() => setOpenModal(null)}>
          <ComingSoonPanel
            icon={UploadCloud}
            message="Uploading an existing recording for transcription is planned for a future update."
          />
        </Modal>
      )}
    </div>
  );
}

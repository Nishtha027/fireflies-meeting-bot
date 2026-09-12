"use client";

import { useState } from "react";
import { CalendarClock, ChevronRight, UploadCloud, Video } from "lucide-react";
import type { ComponentType } from "react";
import { CaptureMeetingModal } from "./CaptureMeetingModal";
import { Modal } from "./Modal";
import { ComingSoonPanel } from "./ComingSoonPanel";

type AccentColor = "indigo" | "sky" | "amber";

const ACCENT_CLASSES: Record<AccentColor, { bg: string; text: string; hover: string }> = {
  indigo: { bg: "bg-indigo-100", text: "text-indigo-600", hover: "hover:border-indigo-300" },
  sky: { bg: "bg-sky-100", text: "text-sky-600", hover: "hover:border-sky-300" },
  amber: { bg: "bg-amber-100", text: "text-amber-600", hover: "hover:border-amber-300" },
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
      className={`flex items-center gap-3.5 rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:shadow-md ${colors.hover}`}
    >
      <span
        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${colors.bg} ${colors.text}`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900">
          {label}
        </span>
        <span className="block truncate text-xs text-slate-500">
          {description}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
    </button>
  );
}

export function QuickStart() {
  const [openModal, setOpenModal] = useState<
    "capture" | "schedule" | "upload" | null
  >(null);

  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900">Quick Start</h2>
      <p className="mt-1 text-sm text-slate-500">
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

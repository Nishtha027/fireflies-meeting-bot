// Mirrors backend/schemas.py - the Pydantic response models our FastAPI
// backend actually returns. Keep in sync with that file, not the other way
// around.

export interface HealthResponse {
  status: string;
  database: string;
}

export interface MeetingListItem {
  id: number;
  platform: string;
  native_meeting_id: string;
  start_time: string | null;
  end_time: string | null;
  status: string;
  overview_preview: string | null;
}

export interface TranscriptSegment {
  speaker_label: string;
  text: string;
  start_timestamp: number;
  end_timestamp: number;
}

export interface Summary {
  overview_text: string;
  key_points: string[];
  decisions: string[];
}

export interface ActionItem {
  description: string;
  assignee_guess: string | null;
}

export interface MeetingDetail {
  id: number;
  platform: string;
  native_meeting_id: string;
  vexa_meeting_id: number | null;
  start_time: string | null;
  end_time: string | null;
  status: string;
  transcript: TranscriptSegment[];
  summary: Summary | null;
  action_items: ActionItem[];
}

export interface IngestResponse {
  success: boolean;
  meeting_id: number;
  status: string;
  segments_saved: number;
  warning: string | null;
}

export interface SummarizeResponse {
  success: boolean;
  meeting_id: number;
  overview: string;
  key_points: string[];
  decisions: string[];
  action_items: ActionItem[];
}

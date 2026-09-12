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

export interface SearchResult {
  meeting_id: number;
  platform: string;
  native_meeting_id: string;
  start_time: string | null;
  end_time: string | null;
  status: string;
  matched_field: string | null;
  snippet: string | null;
  rank: number;
}

export interface ActionItemWithMeeting {
  id: number;
  description: string;
  assignee_guess: string | null;
  generated_at: string;
  meeting_id: number;
  platform: string;
  native_meeting_id: string;
  meeting_start_time: string | null;
}

export interface ChatSource {
  meeting_id: number;
  native_meeting_id: string;
  platform: string;
  start_time: string | null;
  chunk_type: string;
  snippet: string;
}

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
}

export interface EmbedAllEntry {
  meeting_id: number;
  chunks_written: number;
}

export interface EmbedAllResponse {
  success: boolean;
  embedded: EmbedAllEntry[];
  already_embedded: number[];
  skipped_no_content: number[];
}

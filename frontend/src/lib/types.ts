// Mirrors backend/schemas.py - the Pydantic response models our FastAPI
// backend actually returns. Keep in sync with that file, not the other way
// around.

export interface HealthResponse {
  status: string;
  database: string;
}

export interface MeetingListItem {
  id: number;
  title: string | null;
  platform: string;
  native_meeting_id: string;
  start_time: string | null;
  end_time: string | null;
  status: string;
  overview_preview: string | null;
  participants: string[];
}

export interface MeetingTitleUpdateResponse {
  success: boolean;
  meeting_id: number;
  title: string | null;
}

export interface TranscriptSegment {
  speaker_label: string;
  text: string;
  start_timestamp: number;
  end_timestamp: number;
}

export interface Chapter {
  title: string;
  start_time_seconds: number;
}

export interface Summary {
  overview_text: string;
  key_points: string[];
  decisions: string[];
  chapters: Chapter[];
}

export interface ActionItem {
  id: number;
  description: string;
  assignee_guess: string | null;
  completed: boolean;
}

export interface MeetingDetail {
  id: number;
  title: string | null;
  platform: string;
  native_meeting_id: string;
  vexa_meeting_id: number | null;
  start_time: string | null;
  end_time: string | null;
  status: string;
  /** Only ever set for a platform="upload" meeting whose transcription
   * failed (status="failed") - null otherwise. */
  processing_error: string | null;
  participants: string[];
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
  chapters: Chapter[];
}

export interface SearchResult {
  meeting_id: number;
  title: string | null;
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
  completed: boolean;
  meeting_id: number;
  meeting_title: string | null;
  platform: string;
  native_meeting_id: string;
  meeting_start_time: string | null;
}

export interface ChatSource {
  meeting_id: number;
  meeting_title: string | null;
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

export interface SpeakerTalkTime {
  speaker_label: string;
  talk_time_seconds: number;
  percentage: number;
}

export interface MeetingAnalytics {
  meeting_id: number;
  total_duration_seconds: number;
  speakers: SpeakerTalkTime[];
}

export interface TopSpeaker {
  name: string;
  total_minutes: number;
}

export interface AnalyticsOverview {
  total_meetings: number;
  total_duration_seconds: number;
  top_speaker: TopSpeaker | null;
}

export interface CaptureMeetingResponse {
  success: boolean;
  meeting_id: number;
  status: string;
  platform: string;
  native_meeting_id: string;
}

export interface CaptureStatusResponse {
  meeting_id: number;
  status: string;
  segments_saved: number;
  summarized: boolean;
  summarize_error: string | null;
}

export interface AuthResponse {
  success: boolean;
}

export interface MeResponse {
  authenticated: boolean;
  id: number | null;
  name: string | null;
  email: string | null;
}

export interface DeleteMeetingResponse {
  success: boolean;
  meeting_id: number;
}

export interface DeleteActionItemResponse {
  success: boolean;
  action_item_id: number;
}

export interface ParticipantRenameResponse {
  success: boolean;
  meeting_id: number;
  old_name: string;
  new_name: string;
  segments_updated: number;
  merged: boolean;
  chunks_written: number;
}

export interface ManualMeetingResponse {
  success: boolean;
  meeting_id: number;
  segments_saved: number;
  speaker_format_detected: boolean;
  summarized: boolean;
  summarize_error: string | null;
}

export interface UploadMeetingResponse {
  success: boolean;
  meeting_id: number;
  status: string;
}

export interface AccountUpdateResponse {
  success: boolean;
  id: number;
  name: string;
  email: string;
}

export interface ChangePasswordResponse {
  success: boolean;
}

export interface DeleteAccountResponse {
  success: boolean;
}

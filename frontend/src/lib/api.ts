import type {
  AccountUpdateResponse,
  ActionItem,
  ActionItemWithMeeting,
  AnalyticsOverview,
  AuthResponse,
  CaptureMeetingResponse,
  CaptureStatusResponse,
  ChangePasswordResponse,
  ChatResponse,
  DeleteAccountResponse,
  DeleteActionItemResponse,
  DeleteMeetingResponse,
  EmbedAllResponse,
  HealthResponse,
  IngestResponse,
  ManualMeetingResponse,
  MeetingAnalytics,
  MeetingDetail,
  MeetingListItem,
  MeetingTitleUpdateResponse,
  MeResponse,
  ParticipantRenameResponse,
  SearchResult,
  SummarizeResponse,
  UploadMeetingResponse,
} from "./types";

/** Paths the app renders without a session - never bounce these back to
 * themselves on a 401 (avoids a redirect loop, and /auth/me is expected to
 * be called while logged out). */
const PUBLIC_PATHS = ["/login", "/register"];

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** The backend responded, but with a non-2xx status (404, 422, 500, ...). */
export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** fetch() itself failed - the server is unreachable, not just erroring. */
export class NetworkError extends Error {
  constructor(message = "Can't connect to the server.") {
    super(message);
    this.name = "NetworkError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: "include",
    });
  } catch {
    throw new NetworkError();
  }

  // A 401 from any call means the session is missing/expired - send the
  // whole app back to /login rather than letting the current page render
  // broken/partial data. /auth/me never 401s (it answers 200 with
  // authenticated: false), so this never fires for the login-state check
  // itself or creates a redirect loop.
  if (
    response.status === 401 &&
    typeof window !== "undefined" &&
    !PUBLIC_PATHS.includes(window.location.pathname)
  ) {
    // This is a plain module, not a component - no useRouter() available,
    // and a hard navigation is fine here since the session is already gone.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
  }

  if (!response.ok) {
    let detail = response.statusText || `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      // Body wasn't JSON - fall back to statusText above.
    }
    throw new ApiError(response.status, detail);
  }

  return (await response.json()) as T;
}

export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health");
}

export function getMeetings(): Promise<MeetingListItem[]> {
  return request<MeetingListItem[]>("/meetings");
}

export function getMeeting(id: number): Promise<MeetingDetail> {
  return request<MeetingDetail>(`/meetings/${id}`);
}

export function deleteMeeting(id: number): Promise<DeleteMeetingResponse> {
  return request<DeleteMeetingResponse>(`/meetings/${id}`, { method: "DELETE" });
}

export function updateMeetingTitle(
  id: number,
  title: string | null,
): Promise<MeetingTitleUpdateResponse> {
  return request<MeetingTitleUpdateResponse>(`/meetings/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

export function getParticipants(): Promise<string[]> {
  return request<string[]>("/meetings/participants");
}

/** Renames one participant within a single meeting only - never globally.
 * If newName already belongs to a different participant in the same
 * meeting, the two merge server-side (intentional, not an error). */
export function renameParticipant(
  meetingId: number,
  oldName: string,
  newName: string,
): Promise<ParticipantRenameResponse> {
  return request<ParticipantRenameResponse>(`/meetings/${meetingId}/participants`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ old_name: oldName, new_name: newName }),
  });
}

export interface ManualMeetingPayload {
  title?: string | null;
  /** ISO datetime string; omitted defaults to now server-side. */
  meetingDate?: string | null;
  transcriptText: string;
}

/** Creates a meeting from a pasted transcript - bypasses Vexa entirely, no
 * bot, no audio, ever, for meetings created this way. Summarization runs
 * synchronously server-side before this resolves. */
export function createManualMeeting(
  payload: ManualMeetingPayload,
): Promise<ManualMeetingResponse> {
  return request<ManualMeetingResponse>("/meetings/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: payload.title || null,
      meeting_date: payload.meetingDate || null,
      transcript_text: payload.transcriptText,
    }),
  });
}

/** Uploads an audio/video recording for transcription (platform="upload").
 * Transcription + summarization run afterward as a background task - the
 * response only confirms the meeting was created (status="processing");
 * poll getMeeting(id) for status/processing_error, same as live capture's
 * status polling. No explicit Content-Type header - the browser sets the
 * multipart boundary itself from the FormData body. */
export function uploadMeeting(file: File): Promise<UploadMeetingResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return request<UploadMeetingResponse>("/meetings/upload", {
    method: "POST",
    body: formData,
  });
}

export function ingestMeeting(id: number): Promise<IngestResponse> {
  return request<IngestResponse>(`/meetings/${id}/ingest`, { method: "POST" });
}

export function summarizeMeeting(id: number): Promise<SummarizeResponse> {
  return request<SummarizeResponse>(`/meetings/${id}/summarize`, {
    method: "POST",
  });
}

export function getActionItems(): Promise<ActionItemWithMeeting[]> {
  return request<ActionItemWithMeeting[]>("/action-items");
}

export function createActionItem(
  meetingId: number,
  description: string,
  assigneeGuess: string | null,
): Promise<ActionItem> {
  return request<ActionItem>(`/meetings/${meetingId}/action-items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description, assignee_guess: assigneeGuess }),
  });
}

/** Partial update - only send the field(s) actually changing. Used both for
 * the plain completion-toggle (`{ completed }`) and for editing an item's
 * text (`{ description, assignee_guess }`) - same endpoint, same shape,
 * whichever fields are present. */
export interface ActionItemUpdatePayload {
  completed?: boolean;
  description?: string;
  assignee_guess?: string | null;
}

export function updateActionItem(
  id: number,
  payload: ActionItemUpdatePayload,
): Promise<ActionItemWithMeeting> {
  return request<ActionItemWithMeeting>(`/action-items/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteActionItem(id: number): Promise<DeleteActionItemResponse> {
  return request<DeleteActionItemResponse>(`/action-items/${id}`, { method: "DELETE" });
}

export function getMeetingAnalytics(id: number): Promise<MeetingAnalytics> {
  return request<MeetingAnalytics>(`/meetings/${id}/analytics`);
}

export function getAnalyticsOverview(): Promise<AnalyticsOverview> {
  return request<AnalyticsOverview>("/analytics/overview");
}

export interface SearchParams {
  q?: string;
  fromDate?: string;
  toDate?: string;
  participant?: string;
}

export function searchMeetings(params: SearchParams): Promise<SearchResult[]> {
  const usp = new URLSearchParams();
  if (params.q) usp.set("q", params.q);
  if (params.fromDate) usp.set("from_date", params.fromDate);
  if (params.toDate) usp.set("to_date", params.toDate);
  if (params.participant) usp.set("participant", params.participant);
  return request<SearchResult[]>(`/search?${usp.toString()}`);
}

export function embedAll(): Promise<EmbedAllResponse> {
  return request<EmbedAllResponse>("/embed-all", { method: "POST" });
}

export function askChat(question: string): Promise<ChatResponse> {
  return request<ChatResponse>("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
}

export function captureMeeting(
  meetingUrl: string,
): Promise<CaptureMeetingResponse> {
  return request<CaptureMeetingResponse>("/meetings/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ meeting_url: meetingUrl }),
  });
}

export function getCaptureStatus(id: number): Promise<CaptureStatusResponse> {
  return request<CaptureStatusResponse>(`/meetings/${id}/capture-status`);
}

export function stopRecording(id: number): Promise<CaptureStatusResponse> {
  return request<CaptureStatusResponse>(`/meetings/${id}/stop-recording`, {
    method: "POST",
  });
}

export function register(
  name: string,
  email: string,
  password: string,
): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

export function logout(): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/logout", { method: "POST" });
}

export function getAuthStatus(): Promise<MeResponse> {
  return request<MeResponse>("/auth/me");
}

export function updateAccount(
  name: string,
  email: string,
): Promise<AccountUpdateResponse> {
  return request<AccountUpdateResponse>("/settings/account", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email }),
  });
}

export function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResponse> {
  return request<ChangePasswordResponse>("/settings/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
}

export function deleteAccount(password: string): Promise<DeleteAccountResponse> {
  return request<DeleteAccountResponse>("/settings/delete-account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

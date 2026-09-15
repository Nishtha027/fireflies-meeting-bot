import type {
  AccountUpdateResponse,
  ActionItemWithMeeting,
  AnalyticsOverview,
  AuthResponse,
  CaptureMeetingResponse,
  CaptureStatusResponse,
  ChangePasswordResponse,
  ChatResponse,
  DeleteAccountResponse,
  DeleteMeetingResponse,
  EmbedAllResponse,
  HealthResponse,
  IngestResponse,
  MeetingAnalytics,
  MeetingDetail,
  MeetingListItem,
  MeetingTitleUpdateResponse,
  MeResponse,
  SearchResult,
  SummarizeResponse,
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

export function updateActionItem(
  id: number,
  completed: boolean,
): Promise<ActionItemWithMeeting> {
  return request<ActionItemWithMeeting>(`/action-items/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ completed }),
  });
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

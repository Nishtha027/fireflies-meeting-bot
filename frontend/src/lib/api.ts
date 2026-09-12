import type {
  ActionItemWithMeeting,
  AnalyticsOverview,
  ChatResponse,
  EmbedAllResponse,
  HealthResponse,
  IngestResponse,
  MeetingAnalytics,
  MeetingDetail,
  MeetingListItem,
  SearchResult,
  SummarizeResponse,
} from "./types";

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
    response = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new NetworkError();
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
}

export function searchMeetings(params: SearchParams): Promise<SearchResult[]> {
  const usp = new URLSearchParams();
  if (params.q) usp.set("q", params.q);
  if (params.fromDate) usp.set("from_date", params.fromDate);
  if (params.toDate) usp.set("to_date", params.toDate);
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

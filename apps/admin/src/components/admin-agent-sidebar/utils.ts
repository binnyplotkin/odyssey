import type { ChatMessage, Operation, StreamEvent } from "./types";

export async function loadConversation(id: string) {
  const response = await fetch(`/api/admin-agent/conversations/${id}`);
  if (!response.ok) return;
  const detail = await response.json();
  return detail as { messages: ChatMessage[]; operations: Operation[] };
}

export async function readSse(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const line = frame.split("\n").find((part) => part.startsWith("data: "));
      if (line) {
        try {
          onEvent(JSON.parse(line.slice(6)) as StreamEvent);
        } catch {
          // Ignore malformed frames; the final error frame carries failures.
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

export function upsertOperation(list: Operation[], operation: Operation) {
  const exists = list.some((item) => item.id === operation.id);
  if (exists) return list.map((item) => item.id === operation.id ? operation : item);
  return [...list, operation];
}

export function summarizeUnknown(value: unknown) {
  if (!value) return "";
  if (
    typeof value === "object" &&
    "summary" in value &&
    typeof (value as { summary?: unknown }).summary === "string"
  ) {
    return (value as { summary: string }).summary;
  }
  const text = JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

export function extractParams(pathname: string): Record<string, string> {
  const params: Record<string, string> = {};
  const parts = pathname.split("/").filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    if (["characters", "wikis", "worlds", "sessions", "voices"].includes(parts[i]) && parts[i + 1]) {
      params[`${parts[i].slice(0, -1)}IdOrSlug`] = parts[i + 1];
    }
  }
  return params;
}

export function documentTitle() {
  if (typeof document === "undefined") return undefined;
  return document.title || undefined;
}

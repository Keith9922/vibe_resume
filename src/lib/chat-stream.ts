import type { ChatMessage, ChatMode, ChatStreamEvent, JobAnalysis, StoryCard } from "@/lib/types";

export type ChatStreamHandlers = {
  onChunk?: (text: string) => void;
  onMeta?: (story: StoryCard | null, usedAI: boolean) => void;
  onDone?: (fullText: string) => void;
  onError?: (message: string) => void;
};

/**
 * Calls /api/coach/chat and dispatches SSE-like events.
 * Returns the full assembled reply text once done.
 */
export async function streamChat(
  args: {
    mode: ChatMode;
    history: ChatMessage[];
    jobAnalysis: JobAnalysis | null;
    stories: StoryCard[];
    signal?: AbortSignal;
  },
  handlers: ChatStreamHandlers = {},
): Promise<string> {
  const res = await fetch("/api/coach/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: args.mode,
      history: args.history,
      jobAnalysis: args.jobAnalysis,
      stories: args.stories,
    }),
    signal: args.signal,
  });

  if (!res.ok || !res.body) {
    const message = `HTTP ${res.status}`;
    handlers.onError?.(message);
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nlIdx;
      while ((nlIdx = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, nlIdx);
        buffer = buffer.slice(nlIdx + 2);
        const line = block.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          const event = JSON.parse(payload) as ChatStreamEvent;
          switch (event.type) {
            case "chunk":
              full += event.text;
              handlers.onChunk?.(event.text);
              break;
            case "meta":
              handlers.onMeta?.(event.story, event.usedAI);
              break;
            case "done":
              handlers.onDone?.(full);
              break;
            case "error":
              handlers.onError?.(event.message);
              break;
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return full;
}

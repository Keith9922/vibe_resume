import type { InterviewPhase } from "@/lib/types";

export type ChatStreamArgs = {
  messages: { role: "user" | "assistant"; content: string }[];
  jd: string | null;
  phase: InterviewPhase;
  turnCount: number;
  signal?: AbortSignal;
};

export type ChatStreamHandlers = {
  onChunk?: (text: string) => void;
  onMeta?: (info: { phase: InterviewPhase; usedAI: boolean }) => void;
  onDone?: (fullText: string) => void;
  onError?: (message: string) => void;
};

/**
 * Calls /api/coach/chat and dispatches SSE events.
 * Returns the full assembled reply text once done.
 */
export async function streamChat(args: ChatStreamArgs, handlers: ChatStreamHandlers = {}): Promise<string> {
  const res = await fetch("/api/coach/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: args.messages,
      jd: args.jd,
      phase: args.phase,
      turnCount: args.turnCount,
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

      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = block.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          const event = JSON.parse(payload);
          switch (event.type) {
            case "chunk":
              full += event.text;
              handlers.onChunk?.(event.text);
              break;
            case "meta":
              handlers.onMeta?.({ phase: event.phase, usedAI: event.usedAI });
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

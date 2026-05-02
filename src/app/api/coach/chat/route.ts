import type { InterviewPhase } from "@/lib/types";
import { advancePhase, buildVoiceInterviewSystemPrompt, FALLBACK_QUESTIONS } from "@/lib/interview-prompts";
import { hasMiniMaxConfig, streamMiniMaxInterview } from "@/lib/minimax";

export const runtime = "nodejs";

type ChatStreamRequest = {
  messages: { role: "user" | "assistant"; content: string }[];
  jd: string | null;
  phase: InterviewPhase;
  turnCount: number;
};

type ChatStreamEvent =
  | { type: "chunk"; text: string }
  | { type: "meta"; phase: InterviewPhase; usedAI: boolean }
  | { type: "done" }
  | { type: "error"; message: string };

/**
 * Streaming voice chat endpoint.
 *
 * Wire format: SSE — each event is `data: {json}\n\n`.
 * Reuses the existing /api/interview phase machine (advancePhase + the same
 * system prompt) but wraps the prompt with a voice constraint addendum and
 * streams the reply chunk-by-chunk so the client can start TTS immediately.
 *
 * The `meta` event at the end carries the new phase so the client can persist it.
 */
export async function POST(request: Request) {
  let body: ChatStreamRequest;
  try {
    body = (await request.json()) as ChatStreamRequest;
  } catch {
    return jsonError(400, "请求体必须是合法 JSON");
  }

  const { messages = [], jd = null, phase = "intro", turnCount = 0 } = body;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: ChatStreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const aiConfigured = hasMiniMaxConfig();
        const nextPhase = advancePhase(phase, turnCount);
        const systemPrompt = buildVoiceInterviewSystemPrompt(jd, nextPhase);

        // Special case: no user messages yet → seed with "请开始访谈"
        const seededHistory =
          messages.length === 0
            ? [{ role: "user" as const, content: "请开始访谈。" }]
            : messages;

        let aggregated = "";
        let streamed = false;

        if (aiConfigured) {
          for await (const chunk of streamMiniMaxInterview(systemPrompt, seededHistory, {
            temperature: 0.7,
            maxTokens: 200,
          })) {
            streamed = true;
            aggregated += chunk;
            send({ type: "chunk", text: chunk });
          }
        }

        // Fallback: AI unavailable or returned nothing → chunked phase fallback
        if (!streamed || !aggregated.trim()) {
          const fallback = FALLBACK_QUESTIONS[nextPhase];
          for (const piece of chunkText(fallback, 6)) {
            send({ type: "chunk", text: piece });
            await sleep(35);
          }
          aggregated = fallback;
        }

        send({ type: "meta", phase: nextPhase, usedAI: aiConfigured && streamed });
        send({ type: "done" });
      } catch (err) {
        console.error("Voice chat stream error:", err);
        send({ type: "error", message: err instanceof Error ? err.message : "未知错误" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function* chunkText(text: string, size: number): Generator<string> {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

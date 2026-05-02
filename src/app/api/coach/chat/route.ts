import { chatRequestSchema } from "@/lib/coach-schemas";
import { extractStoryWithMiniMax, hasMiniMaxConfig, streamMiniMaxChat } from "@/lib/minimax";
import { extractStoriesFromAnswer, getNextQuestion } from "@/lib/resume-engine";
import type { ChatStreamEvent, StoryCard } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Streaming chat endpoint.
 *
 * Wire format: SSE-ish — each event is a single line `data: {json}\n\n`.
 * Event payloads conform to ChatStreamEvent.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "请求体必须是合法 JSON");
  }

  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "请求格式不正确");
  }

  const { mode, history, jobAnalysis, stories } = parsed.data;
  const lastUserMsg = [...history].reverse().find((m) => m.role === "user");
  if (!lastUserMsg) {
    return jsonError(400, "历史中找不到用户消息");
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: ChatStreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const aiConfigured = hasMiniMaxConfig();
        let streamed = false;
        let aggregated = "";

        if (aiConfigured) {
          for await (const chunk of streamMiniMaxChat(history, jobAnalysis, mode)) {
            streamed = true;
            aggregated += chunk;
            send({ type: "chunk", text: chunk });
          }
        }

        // Fallback when AI is unavailable / yielded nothing
        if (!streamed) {
          const fallback = buildLocalReply(lastUserMsg.content, stories, jobAnalysis, mode);
          for (const piece of chunkText(fallback, mode === "voice" ? 4 : 8)) {
            send({ type: "chunk", text: piece });
            await sleep(mode === "voice" ? 30 : 20);
          }
          aggregated = fallback;
        }

        // Silent story extraction
        let extracted: StoryCard | null = null;
        if (aiConfigured) {
          extracted = await extractStoryWithMiniMax(lastUserMsg.content);
        }
        if (!extracted) {
          const local = extractStoriesFromAnswer(lastUserMsg.content, stories, jobAnalysis);
          extracted = local[0] ?? null;
          if (extracted) {
            // Hide the cards from the user — auto-confirm, drop follow-ups.
            extracted = { ...extracted, status: "confirmed", followUps: [] };
          }
        }

        send({ type: "meta", story: extracted, usedAI: aiConfigured && aggregated.length > 0 });
        send({ type: "done" });
      } catch (err) {
        console.error("Chat stream error:", err);
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

function buildLocalReply(
  userText: string,
  stories: import("@/lib/types").StoryCard[],
  jobAnalysis: import("@/lib/types").JobAnalysis | null,
  mode: import("@/lib/types").ChatMode,
): string {
  const local = extractStoriesFromAnswer(userText, stories, jobAnalysis);
  const allStories = local.length > 0 ? [...stories, ...local] : stories;
  const nextQ = getNextQuestion(allStories, jobAnalysis);

  if (mode === "voice") {
    // 1-2 short sentences for TTS
    return condense(nextQ, 60);
  }
  return nextQ;
}

function condense(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  // Try to cut at the last punctuation before maxChars
  const slice = text.slice(0, maxChars);
  const cut = Math.max(slice.lastIndexOf("。"), slice.lastIndexOf("？"), slice.lastIndexOf("，"));
  return cut > 20 ? slice.slice(0, cut + 1) : slice + "…";
}

function* chunkText(text: string, size: number): Generator<string> {
  for (let i = 0; i < text.length; i += size) {
    yield text.slice(i, i + size);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

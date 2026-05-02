import type {
  ChatMessage,
  ChatMode,
  CoachRequest,
  CoachResponse,
  JobAnalysis,
  StoryCard,
} from "@/lib/types";
import { JSON_TASK_PROMPT, CHAT_PROMPT_TEXT, CHAT_PROMPT_VOICE, STORY_EXTRACTOR_PROMPT } from "@/lib/coach-prompts";
import { createId, nowIso } from "@/lib/ids";

type MiniMaxMessage = { role: "system" | "user" | "assistant"; content: string };
type MiniMaxResponse = { choices?: { message?: { content?: string } }[] };

export function hasMiniMaxConfig(): boolean {
  return Boolean(process.env.MINIMAX_API_KEY?.trim());
}

function getConfig() {
  return {
    apiKey: process.env.MINIMAX_API_KEY?.trim() ?? "",
    baseUrl: (process.env.MINIMAX_BASE_URL || "https://api.minimax.io/v1").replace(/\/$/, ""),
    model: process.env.MINIMAX_MODEL?.trim() || "MiniMax-M1",
  };
}

// ── Legacy JSON actions (analyze-jd, generate-resume) ────────────────────

export async function runMiniMaxCoach(request: CoachRequest, fallback: CoachResponse): Promise<CoachResponse> {
  const { apiKey, baseUrl, model } = getConfig();
  if (!apiKey) return fallback;

  const messages: MiniMaxMessage[] = [
    { role: "system", content: JSON_TASK_PROMPT },
    {
      role: "user",
      content: JSON.stringify({ task: request.action, input: request, referenceOutputShape: fallback }, null, 2),
    },
  ];

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 2048 }),
    });
  } catch (err) {
    console.error("MiniMax network error:", err);
    return fallback;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("MiniMax request failed:", response.status, redactSecrets(detail));
    return fallback;
  }

  const payload = (await response.json()) as MiniMaxResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (!content) return fallback;

  try {
    const parsed = parseJsonObject(content) as CoachResponse;
    return { ...parsed, usedAI: true } as CoachResponse;
  } catch (error) {
    console.error("MiniMax JSON parse failed:", error);
    return fallback;
  }
}

// ── Streaming chat ────────────────────────────────────────────────────────
//
// The MiniMax API is OpenAI-compatible; setting `stream: true` returns SSE
// chunks of the form `data: { choices: [{ delta: { content: "..." }}]}`.
//
// We expose an async iterator of text deltas. If the API key is missing or
// the request fails, we yield no chunks and the caller will use its
// pre-prepared fallback text instead.

export async function* streamMiniMaxChat(
  history: ChatMessage[],
  jobAnalysis: JobAnalysis | null,
  mode: ChatMode,
): AsyncGenerator<string> {
  const { apiKey, baseUrl, model } = getConfig();
  if (!apiKey) return;

  const systemPrompt = mode === "voice" ? CHAT_PROMPT_VOICE : CHAT_PROMPT_TEXT;
  const jdContext = jobAnalysis
    ? `\n\n# 当前 JD 信息（用于内化追问方向，不要直接复述）\n岗位：${jobAnalysis.title}\n关键能力：${jobAnalysis.keywords.join("、") || "（未识别）"}\n弱覆盖/缺失：${jobAnalysis.requirements.filter((r) => r.coverage !== "covered").map((r) => r.label).join("、") || "（无）"}`
    : "";

  const messages: MiniMaxMessage[] = [
    { role: "system", content: systemPrompt + jdContext },
    ...history.map<MiniMaxMessage>((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    })),
  ];

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: mode === "voice" ? 200 : 600,
        stream: true,
      }),
    });
  } catch (err) {
    console.error("MiniMax stream network error:", err);
    return;
  }

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    console.error("MiniMax stream failed:", response.status, redactSecrets(detail));
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE: lines separated by \n, blocks by \n\n
    let nlIdx;
    while ((nlIdx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nlIdx).trim();
      buffer = buffer.slice(nlIdx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const parsed = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // ignore parse errors on partial chunks
      }
    }
  }
}

// ── Silent story extractor (runs after streaming reply) ────────────────────

type ExtractedStoryShape = {
  story: {
    title?: string;
    context?: string;
    role?: string;
    actions?: string[];
    result?: string;
    skills?: string[];
    metrics?: string[];
  } | null;
};

export async function extractStoryWithMiniMax(userMessage: string): Promise<StoryCard | null> {
  const { apiKey, baseUrl, model } = getConfig();
  if (!apiKey) return null;
  if (!userMessage.trim()) return null;

  const messages: MiniMaxMessage[] = [
    { role: "system", content: STORY_EXTRACTOR_PROMPT },
    { role: "user", content: userMessage },
  ];

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 800 }),
    });
  } catch (err) {
    console.error("MiniMax extract network error:", err);
    return null;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("MiniMax extract failed:", response.status, redactSecrets(detail));
    return null;
  }

  const payload = (await response.json()) as MiniMaxResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (!content) return null;

  try {
    const parsed = parseJsonObject(content) as ExtractedStoryShape;
    if (!parsed.story) return null;
    const s = parsed.story;
    if (!s.actions?.length && !s.result?.trim()) return null;

    return {
      id: createId("story"),
      title: s.title?.trim() || "未命名经历",
      context: s.context?.trim() || "",
      role: s.role?.trim() || "",
      actions: (s.actions ?? []).filter(Boolean),
      result: s.result?.trim() || "",
      evidence: (s.metrics ?? []).filter(Boolean).map((value) => ({
        id: createId("ev"),
        label: "数据",
        value,
        strength: "medium" as const,
      })),
      skills: (s.skills ?? []).filter(Boolean),
      followUps: [],
      status: "confirmed",
      sourceQuote: userMessage,
      createdAt: nowIso(),
    };
  } catch (error) {
    console.error("MiniMax extract parse failed:", error);
    return null;
  }
}

// ── Speech to text ────────────────────────────────────────────────────────

export async function transcribeAudio(audioBuffer: ArrayBuffer, mimeType: string): Promise<string | null> {
  const { apiKey, baseUrl } = getConfig();
  if (!apiKey) return null;

  const ext = mimeType.includes("webm") ? "webm"
    : mimeType.includes("mp4") ? "mp4"
    : mimeType.includes("ogg") ? "ogg"
    : mimeType.includes("wav") ? "wav"
    : "webm";

  const formData = new FormData();
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
  formData.append("file", blob, `recording.${ext}`);
  formData.append("model", "speech-01");

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });
  } catch (err) {
    console.error("MiniMax ASR network error:", err);
    return null;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("MiniMax ASR failed:", response.status, redactSecrets(detail));
    return null;
  }

  try {
    const result = (await response.json()) as { text?: string };
    return result.text?.trim() ?? null;
  } catch {
    return null;
  }
}

// ── Private helpers ───────────────────────────────────────────────────────

function parseJsonObject(value: string): unknown {
  const first = value.indexOf("{");
  const last = value.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) throw new Error("No JSON object found");
  return JSON.parse(value.slice(first, last + 1));
}

function redactSecrets(value: string): string {
  return value.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***").replace(/sk-[A-Za-z0-9._-]+/g, "sk-***");
}

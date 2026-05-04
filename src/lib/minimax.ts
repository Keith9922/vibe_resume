/**
 * MiniMax integration — three modes:
 *  1. runMiniMaxInterview: conversational chat (interview)
 *  2. runMiniMaxJsonTask: synthesize / generate-resume / analyze-jd (returns parsed JSON)
 *  3. transcribeAudio: speech-to-text
 */

type MiniMaxMessage = { role: "system" | "user" | "assistant"; content: string };
type MiniMaxResponse = {
  choices?: { message?: { content?: string } }[];
  base_resp?: { status_code?: number; status_msg?: string };
};

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

// ─── Conversational (returns plain text reply) ──────────────────────────────

export async function runMiniMaxInterview(
  systemPrompt: string,
  history: { role: "user" | "assistant"; content: string }[],
  options: { temperature?: number; maxTokens?: number } = {},
): Promise<{ message: string; usedAI: boolean }> {
  const { apiKey, baseUrl, model } = getConfig();
  if (!apiKey) return { message: "", usedAI: false };

  const messages: MiniMaxMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 512,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("MiniMax interview failed:", response.status, redactSecrets(detail));
      return { message: "", usedAI: false };
    }

    const payload = (await response.json()) as MiniMaxResponse;
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) return { message: "", usedAI: false };

    return { message: cleanReply(content), usedAI: true };
  } catch (err) {
    console.error("MiniMax interview network error:", err);
    return { message: "", usedAI: false };
  }
}

// ─── JSON tasks (returns parsed object/array) ────────────────────────────────

export async function runMiniMaxJsonTask<T>(
  systemPrompt: string,
  userPayload: unknown,
  options: { temperature?: number; maxTokens?: number } = {},
): Promise<{ data: T | null; usedAI: boolean }> {
  const { apiKey, baseUrl, model } = getConfig();
  if (!apiKey) return { data: null, usedAI: false };

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: typeof userPayload === "string" ? userPayload : JSON.stringify(userPayload, null, 2) },
        ],
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 2048,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("MiniMax JSON task failed:", response.status, redactSecrets(detail));
      return { data: null, usedAI: false };
    }

    const payload = (await response.json()) as MiniMaxResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return { data: null, usedAI: false };

    const parsed = parseJsonFromText<T>(content);
    return { data: parsed, usedAI: true };
  } catch (err) {
    console.error("MiniMax JSON network error:", err);
    return { data: null, usedAI: false };
  }
}

// ─── Speech to text ─────────────────────────────────────────────────────────

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

  try {
    const response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("MiniMax ASR failed:", response.status, redactSecrets(detail));
      return null;
    }
    const result = (await response.json()) as { text?: string };
    return result.text?.trim() ?? null;
  } catch (err) {
    console.error("MiniMax ASR network error:", err);
    return null;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Extract first JSON object/array from text, tolerating markdown fences. */
function parseJsonFromText<T>(value: string): T | null {
  const stripped = value.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  const candidates: [number, number][] = [];
  const objStart = stripped.indexOf("{");
  const objEnd = stripped.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) candidates.push([objStart, objEnd]);
  const arrStart = stripped.indexOf("[");
  const arrEnd = stripped.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) candidates.push([arrStart, arrEnd]);

  candidates.sort((a, b) => a[0] - b[0]);

  for (const [start, end] of candidates) {
    try {
      return JSON.parse(stripped.slice(start, end + 1)) as T;
    } catch {
      continue;
    }
  }
  return null;
}

/** Strip leading/trailing quotes and clean up the AI's reply text. */
function cleanReply(s: string): string {
  let out = s.trim();
  if ((out.startsWith("\"") && out.endsWith("\"")) || (out.startsWith("“") && out.endsWith("”"))) {
    out = out.slice(1, -1).trim();
  }
  out = out.replace(/^(回答[:：]\s*|Q[:：]\s*|A[:：]\s*|Answer[:：]\s*|Question[:：]\s*)/i, "");
  return out;
}

function redactSecrets(value: string): string {
  return value.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***").replace(/sk-[A-Za-z0-9._-]+/g, "sk-***");
}

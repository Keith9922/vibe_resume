import { synthesizeWithEdge } from "@/lib/tts-edge";

/**
 * TTS proxy with provider chain:
 *   1. Edge TTS — free Microsoft Read Aloud, default. Good zh-CN quality.
 *   2. MiniMax TTS — only if MINIMAX_TTS_MODEL is set AND Edge fails.
 *   3. 503 — client falls back to browser SpeechSynthesis.
 *
 * POST /api/tts { text: string, voice?: string }
 *  → 200 audio/mpeg (mp3 binary)
 *  → 503 application/json { reason, message } on all-providers-failed
 *
 * Why this order: Edge is free, fast, and the zh-CN voices (especially
 * Xiaoxiao / Yunxi) are widely considered the best free TTS available.
 * MiniMax stays in the chain so the user can switch providers by env
 * without code changes once they upgrade their plan.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

type ProviderResult =
  | { ok: true; audio: Buffer; provider: "edge" | "minimax" }
  | { ok: false; reason: string; message: string };

export async function POST(request: Request) {
  let body: { text?: string; voice?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "bad-request", "请求体必须是合法 JSON");
  }

  const text = body.text?.trim();
  if (!text) return jsonError(400, "empty-text", "text 不能为空");
  if (text.length > 5000) return jsonError(400, "text-too-long", "text 不能超过 5000 字");

  // Tier 1 — Edge TTS
  const edgeResult = await tryEdge(text, body.voice);
  if (edgeResult.ok) return audioResponse(edgeResult.audio, "edge");

  // Tier 2 — MiniMax (only if explicitly configured)
  const minimaxResult = await tryMiniMax(text, body.voice);
  if (minimaxResult.ok) return audioResponse(minimaxResult.audio, "minimax");

  // All failed — return the more informative error
  console.warn("All TTS providers failed:", { edge: edgeResult, minimax: minimaxResult });
  return jsonError(503, edgeResult.reason, edgeResult.message);
}

// ── Tier 1 ──────────────────────────────────────────────────────────────

async function tryEdge(text: string, voice?: string): Promise<ProviderResult> {
  try {
    const audio = await synthesizeWithEdge(text, { voice });
    if (!audio || audio.length === 0) {
      return { ok: false, reason: "edge-empty", message: "Edge TTS 返回空音频" };
    }
    return { ok: true, audio, provider: "edge" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";
    console.warn("Edge TTS failed:", message);
    return { ok: false, reason: "edge-error", message: `Edge TTS: ${message}` };
  }
}

// ── Tier 2 ──────────────────────────────────────────────────────────────

type MiniMaxTtsResponse = {
  data?: { audio?: string };
  base_resp?: { status_code?: number; status_msg?: string };
};

async function tryMiniMax(text: string, voiceOverride?: string): Promise<ProviderResult> {
  const apiKey = process.env.MINIMAX_API_KEY?.trim();
  const baseUrl = (process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1").replace(/\/$/, "");
  const ttsModel = process.env.MINIMAX_TTS_MODEL?.trim();
  const voiceId = voiceOverride || process.env.MINIMAX_TTS_VOICE_ID?.trim() || "female-tianmei";

  if (!apiKey || !ttsModel) {
    return { ok: false, reason: "minimax-not-configured", message: "MiniMax TTS 未配置" };
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/t2a_v2`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ttsModel,
        text,
        stream: false,
        voice_setting: { voice_id: voiceId, speed: 1.0, vol: 1.0, pitch: 0 },
        audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
        output_format: "hex",
      }),
    });
  } catch (err) {
    return { ok: false, reason: "minimax-network", message: err instanceof Error ? err.message : "网络错误" };
  }

  if (!response.ok) {
    return { ok: false, reason: "minimax-http", message: `HTTP ${response.status}` };
  }

  let payload: MiniMaxTtsResponse;
  try {
    payload = (await response.json()) as MiniMaxTtsResponse;
  } catch {
    return { ok: false, reason: "minimax-parse", message: "响应不是 JSON" };
  }

  const status = payload.base_resp?.status_code;
  if (status !== 0) {
    const reason = status === 2061 ? "minimax-plan-not-supported" : "minimax-api-error";
    return { ok: false, reason, message: payload.base_resp?.status_msg || "TTS 调用被拒" };
  }

  const hex = payload.data?.audio;
  if (!hex) return { ok: false, reason: "minimax-empty", message: "MiniMax 返回空音频" };

  return { ok: true, audio: Buffer.from(hex, "hex"), provider: "minimax" };
}

// ── Helpers ────────────────────────────────────────────────────────────

function audioResponse(audio: Buffer, provider: string): Response {
  return new Response(new Uint8Array(audio), {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audio.length),
      "Cache-Control": "no-store",
      "X-TTS-Provider": provider,
    },
  });
}

function jsonError(status: number, reason: string, message: string): Response {
  return new Response(JSON.stringify({ reason, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * MiniMax TTS proxy.
 *
 * POST /api/tts { text: string, voiceId?: string }
 *  → 200 audio/mpeg binary on success
 *  → 503 application/json { reason } when MiniMax TTS is unavailable
 *
 * Server-side proxy keeps the API key off the client. We decode MiniMax's hex
 * audio payload back to binary and stream it as a regular mp3 the browser can
 * play with HTMLAudioElement.
 *
 * If MINIMAX_TTS_MODEL is unset we 503 immediately so the client falls back
 * to browser SpeechSynthesis without even round-tripping.
 */
export const runtime = "nodejs";

type MiniMaxTtsResponse = {
  data?: { audio?: string; status?: number };
  base_resp?: { status_code?: number; status_msg?: string };
  extra_info?: { audio_format?: string; audio_size?: number };
};

export async function POST(request: Request) {
  const apiKey = process.env.MINIMAX_API_KEY?.trim();
  const baseUrl = (process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1").replace(/\/$/, "");
  const ttsModel = process.env.MINIMAX_TTS_MODEL?.trim();
  const defaultVoiceId = process.env.MINIMAX_TTS_VOICE_ID?.trim() || "female-tianmei";

  if (!apiKey || !ttsModel) {
    return jsonError(503, "tts-not-configured", "MiniMax TTS not configured (missing MINIMAX_API_KEY or MINIMAX_TTS_MODEL)");
  }

  let body: { text?: string; voiceId?: string };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "bad-request", "请求体必须是合法 JSON");
  }

  const text = body.text?.trim();
  if (!text) return jsonError(400, "empty-text", "text 不能为空");
  if (text.length > 5000) return jsonError(400, "text-too-long", "text 不能超过 5000 字");

  const voiceId = body.voiceId?.trim() || defaultVoiceId;

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
    console.error("MiniMax TTS network error:", err);
    return jsonError(503, "network", "MiniMax TTS 网络错误");
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("MiniMax TTS HTTP error:", response.status, redact(detail).slice(0, 300));
    return jsonError(503, "http-error", `MiniMax TTS HTTP ${response.status}`);
  }

  let payload: MiniMaxTtsResponse;
  try {
    payload = (await response.json()) as MiniMaxTtsResponse;
  } catch (err) {
    console.error("MiniMax TTS parse error:", err);
    return jsonError(503, "parse", "MiniMax TTS 响应不是 JSON");
  }

  const status = payload.base_resp?.status_code;
  if (status !== 0) {
    // 2061 = plan does not support model; user has to upgrade. Surface explicit reason.
    const reason = status === 2061 ? "plan-not-supported" : "api-error";
    console.warn(`MiniMax TTS denied: ${status} ${payload.base_resp?.status_msg}`);
    return jsonError(503, reason, payload.base_resp?.status_msg || "TTS 调用被拒");
  }

  const hex = payload.data?.audio;
  if (!hex) return jsonError(503, "empty-audio", "MiniMax TTS 返回空音频");

  const audio = Buffer.from(hex, "hex");

  return new Response(new Uint8Array(audio), {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audio.length),
      "Cache-Control": "no-store",
    },
  });
}

function jsonError(status: number, reason: string, message: string): Response {
  return new Response(JSON.stringify({ reason, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function redact(value: string): string {
  return value.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***").replace(/sk-[A-Za-z0-9._-]+/g, "sk-***");
}

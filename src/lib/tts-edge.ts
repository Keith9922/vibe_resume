import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

/**
 * Microsoft Edge "Read Aloud" TTS — free, no API key.
 *
 * Uses the public WSS endpoint that Edge ships with for its built-in
 * read-aloud feature. The msedge-tts package handles WebSocket auth
 * (rotating Sec-MS-GEC token) and SSML construction.
 *
 * Returns an mp3 Buffer ready to send back as audio/mpeg.
 *
 * Voice IDs (recommended for our resume coach):
 *   - zh-CN-XiaoxiaoNeural  warm female, most natural — DEFAULT
 *   - zh-CN-XiaoyiNeural    softer female
 *   - zh-CN-YunxiNeural     casual young male, "buddy" tone
 *   - zh-CN-YunyangNeural   professional male anchor
 *   - zh-CN-YunjianNeural   deep male
 */

const SYNTH_TIMEOUT_MS = 12_000;

export type EdgeSynthOptions = {
  voice?: string;
  rate?: string;  // SSML rate, e.g. "+5%" or "-10%"
  pitch?: string; // SSML pitch, e.g. "+0Hz"
  volume?: string;
};

export async function synthesizeWithEdge(text: string, opts: EdgeSynthOptions = {}): Promise<Buffer> {
  const voice = opts.voice || process.env.EDGE_TTS_VOICE?.trim() || "zh-CN-XiaoxiaoNeural";

  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const { audioStream } = await tts.toStream(text, {
    rate: opts.rate ?? "+0%",
    pitch: opts.pitch ?? "+0Hz",
    volume: opts.volume ?? "+0%",
  });

  try {
    return await collectStream(audioStream, SYNTH_TIMEOUT_MS);
  } finally {
    try { tts.close(); } catch { /* ignore */ }
  }
}

function collectStream(stream: NodeJS.ReadableStream, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      stream.removeAllListeners();
      reject(new Error(`edge-tts timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
    stream.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

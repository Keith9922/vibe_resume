/**
 * Audio capture (mic → PCM 16k Int16 chunks) and playback (PCM 24k Int16 chunks
 * scheduled into AudioContext) for the 火山豆包 realtime pipeline.
 *
 * - Capture uses an AudioWorklet (public/audio-worklet/pcm-encoder.js) to do
 *   downsampling off the main thread.
 * - Playback uses a queue of AudioBufferSourceNodes scheduled head-to-tail so
 *   incoming TTSResponse chunks play seamlessly even if they arrive bursty.
 */

export type CapturedChunk = Int16Array; // 320 samples = 20ms @ 16k

// ── capture ─────────────────────────────────────────────────────────────

export type AudioCapture = {
  start: () => Promise<void>;
  stop: () => void;
  /** Pause forwarding PCM chunks (keep stream + worklet alive for fast resume). */
  pause: () => void;
  resume: () => void;
  isActive: () => boolean;
  isPaused: () => boolean;
};

export type CaptureCallbacks = {
  /** 320-sample Int16 PCM @ 16k. Suppressed while paused. */
  onChunk: (chunk: CapturedChunk) => void;
  /** Throttled mic level (RMS) ~16fps. Always emitted, even when paused. */
  onLevel?: (rms: number) => void;
};

type WorkletMsg = { kind: "pcm"; buffer: ArrayBuffer } | { kind: "level"; rms: number };

export function createAudioCapture(callbacks: CaptureCallbacks): AudioCapture {
  let context: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let worklet: AudioWorkletNode | null = null;
  let paused = false;

  return {
    async start() {
      if (context) return;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      context = new AudioContext();
      await context.audioWorklet.addModule("/audio-worklet/pcm-encoder.js");
      source = context.createMediaStreamSource(stream);
      worklet = new AudioWorkletNode(context, "pcm-encoder");
      worklet.port.onmessage = (e: MessageEvent<WorkletMsg>) => {
        const msg = e.data;
        if (!msg) return;
        if (msg.kind === "level") {
          callbacks.onLevel?.(msg.rms);
        } else if (msg.kind === "pcm" && !paused) {
          callbacks.onChunk(new Int16Array(msg.buffer));
        }
      };
      source.connect(worklet);
    },

    stop() {
      try { worklet?.port.close(); } catch { /* ignore */ }
      try { worklet?.disconnect(); } catch { /* ignore */ }
      try { source?.disconnect(); } catch { /* ignore */ }
      try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
      try { context?.close(); } catch { /* ignore */ }
      worklet = null; source = null; stream = null; context = null;
      paused = false;
    },

    pause() { paused = true; },
    resume() { paused = false; },
    isActive() { return !!context; },
    isPaused() { return paused; },
  };
}

// ── playback ────────────────────────────────────────────────────────────

export type AudioPlayback = {
  play: (pcm: Int16Array) => void;
  /** Stop playback immediately (clear queue). For barge-in. */
  flush: () => void;
  close: () => void;
  /** True while there's still queued audio scheduled in the future. */
  isPlaying: () => boolean;
  /** Hook to learn when the queue empties (for state machine transitions). */
  onIdle?: () => void;
};

const SERVER_RATE = 24_000; // 火山 端到端 默认输出（请求 pcm_s16le 时）

export function createAudioPlayback(): AudioPlayback {
  const context = new AudioContext({ sampleRate: SERVER_RATE });
  // Some browsers start AudioContext suspended until user gesture; resume on first play.
  let nextStart = 0;
  const sources = new Set<AudioBufferSourceNode>();
  let idleNotifyQueued = false;
  const api: AudioPlayback = {
    play(pcm) {
      if (context.state === "suspended") void context.resume();

      // Convert Int16 → Float32 [-1, 1]
      const float = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) float[i] = pcm[i] / (pcm[i] < 0 ? 0x8000 : 0x7fff);

      const buffer = context.createBuffer(1, float.length, SERVER_RATE);
      buffer.copyToChannel(float, 0);

      const node = context.createBufferSource();
      node.buffer = buffer;
      node.connect(context.destination);

      const startAt = Math.max(context.currentTime, nextStart);
      node.start(startAt);
      nextStart = startAt + buffer.duration;

      sources.add(node);
      node.onended = () => {
        sources.delete(node);
        if (sources.size === 0 && api.onIdle && !idleNotifyQueued) {
          idleNotifyQueued = true;
          // Coalesce — chunks often arrive back-to-back, only fire onIdle when truly drained
          setTimeout(() => {
            idleNotifyQueued = false;
            if (sources.size === 0 && api.onIdle) api.onIdle();
          }, 100);
        }
      };
    },

    flush() {
      for (const node of sources) {
        try { node.stop(); } catch { /* ignore */ }
        try { node.disconnect(); } catch { /* ignore */ }
      }
      sources.clear();
      nextStart = context.currentTime;
    },

    close() {
      this.flush();
      try { context.close(); } catch { /* ignore */ }
    },

    isPlaying() { return sources.size > 0; },
  };

  return api;
}

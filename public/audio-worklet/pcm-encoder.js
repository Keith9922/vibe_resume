// PCM encoder AudioWorklet — runs in audio thread.
//
// Takes incoming microphone Float32 frames (browser native rate, usually 48k or 44.1k),
// downsamples to 16 kHz, converts to Int16 little-endian, and posts 20ms (320 samples)
// chunks back to the main thread as transferable ArrayBuffers.
//
// Why 20ms / 16 kHz / Int16: matches 火山豆包端到端实时语音 client→server requirement.
// "20ms 一包发送服务端" per their best-practices doc.

const TARGET_RATE = 16_000;
const CHUNK_SAMPLES = 320; // 20ms @ 16k

class PcmEncoderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.inputRate = sampleRate; // global, the AudioContext sample rate
    this.ratio = this.inputRate / TARGET_RATE;
    this.acc = []; // pending downsampled Float32 samples (queue)
    this.fractional = 0;  // fractional index for naive linear resampling
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0]; // mono — first channel only
    if (!channel || channel.length === 0) return true;

    // Naive linear-interpolation downsample. Good enough for speech.
    let i = this.fractional;
    while (i < channel.length) {
      const i0 = Math.floor(i);
      const i1 = Math.min(i0 + 1, channel.length - 1);
      const frac = i - i0;
      const sample = channel[i0] * (1 - frac) + channel[i1] * frac;
      this.acc.push(sample);
      i += this.ratio;
    }
    this.fractional = i - channel.length;

    // Emit in 320-sample chunks
    while (this.acc.length >= CHUNK_SAMPLES) {
      const chunk = this.acc.splice(0, CHUNK_SAMPLES);
      const i16 = new Int16Array(CHUNK_SAMPLES);
      for (let k = 0; k < CHUNK_SAMPLES; k++) {
        // Clamp + convert to Int16
        const s = Math.max(-1, Math.min(1, chunk[k]));
        i16[k] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
      }
      this.port.postMessage(i16.buffer, [i16.buffer]);
    }

    return true; // keep alive
  }
}

registerProcessor("pcm-encoder", PcmEncoderProcessor);

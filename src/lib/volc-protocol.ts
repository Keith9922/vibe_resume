/**
 * Binary frame encoder/decoder for the 火山豆包端到端实时语音 WSS protocol.
 *
 * Frame layout (4-byte header + optional fields + payload size + payload):
 *   byte 0: protocol version (0b0001) | header size in 4-byte units (0b0001) → 0x11
 *   byte 1: msg_type << 4 | flags
 *   byte 2: serialization << 4 | compression
 *   byte 3: 0 reserved
 *   if flag FLAG_EVENT (0b0100): 4-byte event_id (BE)
 *   for connect-level events (1/2/50/51/52): 4-byte connect_id_size + connect_id bytes
 *   for session-level events (100/102/150/152/...): 4-byte session_id_size + session_id bytes
 *   4-byte payload_size (BE)
 *   payload bytes (JSON string OR raw audio)
 *
 * Verified against the live endpoint via scripts/volc-probe.mjs.
 */

export const MSG = {
  FULL_CLIENT: 0b0001,
  FULL_SERVER: 0b1001,
  AUDIO_ONLY_REQ: 0b0010,
  AUDIO_ONLY_RESP: 0b1011,
  ERROR: 0b1111,
} as const;

export const SER = {
  RAW: 0b0000,
  JSON: 0b0001,
} as const;

export const FLAG = {
  NONE: 0b0000,
  EVENT: 0b0100,
} as const;

export const EVT = {
  // client → server
  StartConnection: 1,
  FinishConnection: 2,
  StartSession: 100,
  FinishSession: 102,
  TaskRequest: 200,
  UpdateConfig: 201,
  SayHello: 300,
  EndASR: 400,
  ChatTTSText: 500,
  ChatTextQuery: 501,
  ChatRAGText: 502,
  ClientInterrupt: 515,
  // server → client
  ConnectionStarted: 50,
  ConnectionFailed: 51,
  ConnectionFinished: 52,
  SessionStarted: 150,
  SessionFinished: 152,
  SessionFailed: 153,
  UsageResponse: 154,
  ConfigUpdated: 251,
  TTSSentenceStart: 350,
  TTSSentenceEnd: 351,
  TTSResponse: 352,
  TTSEnded: 359,
  ASRInfo: 450,
  ASRResponse: 451,
  ASREnded: 459,
  ChatResponse: 550,
  ChatTextQueryConfirmed: 553,
  ChatEnded: 559,
  DialogCommonError: 599,
} as const;

const CONNECT_LEVEL = new Set<number>([
  EVT.StartConnection, EVT.FinishConnection,
  EVT.ConnectionStarted, EVT.ConnectionFailed, EVT.ConnectionFinished,
]);

// ── encode ──────────────────────────────────────────────────────────────

type EncodeArgs = {
  msgType: number;
  flags?: number;
  serialization?: number;
  eventId?: number;
  sessionId?: string;
  payload?: ArrayBuffer | Uint8Array | string;
};

export function encodeFrame(args: EncodeArgs): ArrayBuffer {
  const flags = args.flags ?? FLAG.EVENT;
  const ser = args.serialization ?? (args.msgType === MSG.AUDIO_ONLY_REQ ? SER.RAW : SER.JSON);

  const parts: Uint8Array[] = [];

  // 4-byte header
  parts.push(new Uint8Array([
    (0b0001 << 4) | 0b0001,
    (args.msgType << 4) | flags,
    (ser << 4) | 0b0000,
    0,
  ]));

  if (flags & FLAG.EVENT) {
    if (args.eventId === undefined) throw new Error("eventId required when FLAG_EVENT set");
    parts.push(u32be(args.eventId));
  }

  if (args.sessionId) {
    const sid = new TextEncoder().encode(args.sessionId);
    parts.push(u32be(sid.length), sid);
  }

  const payloadBytes = toBytes(args.payload ?? "{}");
  parts.push(u32be(payloadBytes.length), payloadBytes);

  return concat(parts).buffer as ArrayBuffer;
}

// ── decode ──────────────────────────────────────────────────────────────

export type DecodedFrame = {
  msgType: number;
  flags: number;
  serialization: number;
  eventId: number | null;
  /** Either a connect_id or session_id depending on event class. */
  contextId: string | null;
  /** JSON-decoded object when serialization=JSON, else raw bytes. */
  payload: unknown;
  payloadBytes: Uint8Array;
};

export function decodeFrame(data: ArrayBuffer | Uint8Array): DecodedFrame | null {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (buf.length < 4) return null;

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const headerSize = (buf[0] & 0xf) * 4;
  const msgType = (buf[1] >> 4) & 0xf;
  const flags = buf[1] & 0xf;
  const serialization = (buf[2] >> 4) & 0xf;

  let off = headerSize;
  let eventId: number | null = null;
  let contextId: string | null = null;

  if (flags & FLAG.EVENT) {
    if (off + 4 > buf.length) return null;
    eventId = view.getUint32(off, false);
    off += 4;
  }

  // For both connect-level and session-level events the server prepends an id+size.
  // We try to read it; if the size looks unreasonable, rewind.
  if (eventId !== null && off + 4 <= buf.length) {
    const idSize = view.getUint32(off, false);
    if (idSize > 0 && idSize < 200 && off + 4 + idSize <= buf.length) {
      off += 4;
      contextId = new TextDecoder().decode(buf.subarray(off, off + idSize));
      off += idSize;
    }
  }

  if (off + 4 > buf.length) return null;
  const plSize = view.getUint32(off, false);
  off += 4;
  const payloadBytes = buf.subarray(off, off + plSize);

  let payload: unknown = payloadBytes;
  if (serialization === SER.JSON) {
    try {
      const text = new TextDecoder().decode(payloadBytes);
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = new TextDecoder().decode(payloadBytes);
    }
  }

  return { msgType, flags, serialization, eventId, contextId, payload, payloadBytes };
}

// ── utility ─────────────────────────────────────────────────────────────

function u32be(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, false);
  return b;
}

function toBytes(v: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof v === "string") return new TextEncoder().encode(v);
  return v instanceof Uint8Array ? v : new Uint8Array(v);
}

function concat(arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

// ── helpers for common frames ───────────────────────────────────────────

export function startConnectionFrame(): ArrayBuffer {
  return encodeFrame({ msgType: MSG.FULL_CLIENT, eventId: EVT.StartConnection, payload: "{}" });
}

export function finishConnectionFrame(): ArrayBuffer {
  return encodeFrame({ msgType: MSG.FULL_CLIENT, eventId: EVT.FinishConnection, payload: "{}" });
}

export function startSessionFrame(sessionId: string, config: object): ArrayBuffer {
  return encodeFrame({
    msgType: MSG.FULL_CLIENT, eventId: EVT.StartSession,
    sessionId, payload: JSON.stringify(config),
  });
}

export function finishSessionFrame(sessionId: string): ArrayBuffer {
  return encodeFrame({
    msgType: MSG.FULL_CLIENT, eventId: EVT.FinishSession,
    sessionId, payload: "{}",
  });
}

export function audioFrame(sessionId: string, pcm: Int16Array): ArrayBuffer {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return encodeFrame({
    msgType: MSG.AUDIO_ONLY_REQ, eventId: EVT.TaskRequest,
    serialization: SER.RAW, sessionId, payload: bytes,
  });
}

export function clientInterruptFrame(sessionId: string): ArrayBuffer {
  return encodeFrame({
    msgType: MSG.FULL_CLIENT, eventId: EVT.ClientInterrupt,
    sessionId, payload: "{}",
  });
}

export function isConnectLevelEvent(eventId: number | null): boolean {
  return eventId !== null && CONNECT_LEVEL.has(eventId);
}

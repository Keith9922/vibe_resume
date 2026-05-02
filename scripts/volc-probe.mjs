#!/usr/bin/env node
/**
 * Minimal sanity check for the 火山豆包端到端实时语音 API.
 *
 *   StartConnection → ConnectionStarted
 *   StartSession    → SessionStarted
 *   FinishSession   → SessionFinished
 *   FinishConnection→ ConnectionFinished
 *
 * No audio is sent, so the model is never invoked → token cost ≈ 0.
 * Goal: prove auth headers + binary protocol framing both work.
 *
 * Run: node scripts/volc-probe.mjs
 */
import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

// Load .env.local
const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, "..", ".env.local"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

const URL = env.VOLC_WSS_URL;
const APP_ID = env.VOLC_APP_ID;
const ACCESS_KEY = env.VOLC_ACCESS_KEY;
const RESOURCE_ID = env.VOLC_RESOURCE_ID;
const APP_KEY = env.VOLC_APP_KEY;

if (!URL || !APP_ID || !ACCESS_KEY || !RESOURCE_ID || !APP_KEY) {
  console.error("missing env: VOLC_WSS_URL / VOLC_APP_ID / VOLC_ACCESS_KEY / VOLC_RESOURCE_ID / VOLC_APP_KEY");
  process.exit(1);
}

// ── Binary protocol helpers (4-byte header + optional + payload size + payload)

const MSG_FULL_CLIENT = 0b0001;
const MSG_ERROR = 0b1111;

const SER_JSON = 0b0001;

const FLAG_EVENT = 0b0100;

const EVT_StartConnection = 1;
const EVT_FinishConnection = 2;
const EVT_StartSession = 100;
const EVT_FinishSession = 102;

function buildFrame({ msgType, flags, serialization, eventId, sessionId, payload }) {
  // Byte 0: protocol version (0b0001) | header size (0b0001 = 4 bytes)
  // Byte 1: msg type | flags
  // Byte 2: serialization | compression (0)
  // Byte 3: reserved
  const header = Buffer.from([
    (0b0001 << 4) | 0b0001,
    (msgType << 4) | flags,
    (serialization << 4) | 0b0000,
    0,
  ]);

  const parts = [header];

  if (flags & FLAG_EVENT) {
    const ev = Buffer.alloc(4);
    ev.writeUInt32BE(eventId, 0);
    parts.push(ev);
  }

  if (sessionId) {
    const sid = Buffer.from(sessionId, "utf8");
    const size = Buffer.alloc(4);
    size.writeUInt32BE(sid.length, 0);
    parts.push(size, sid);
  }

  const pl = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? "{}", "utf8");
  const plSize = Buffer.alloc(4);
  plSize.writeUInt32BE(pl.length, 0);
  parts.push(plSize, pl);

  return Buffer.concat(parts);
}

function parseFrame(buf) {
  if (buf.length < 4) return { error: "frame too short" };
  const b0 = buf[0];
  const b1 = buf[1];
  const b2 = buf[2];
  const protoVer = (b0 >> 4) & 0xf;
  const headerSize = (b0 & 0xf) * 4;
  const msgType = (b1 >> 4) & 0xf;
  const flags = b1 & 0xf;
  const serialization = (b2 >> 4) & 0xf;

  let off = headerSize;
  let eventId = null, sessionId = null;

  if (flags & FLAG_EVENT) {
    eventId = buf.readUInt32BE(off);
    off += 4;
  }
  // For session-level events server includes session_id
  if (eventId && eventId >= 100 && off + 4 <= buf.length) {
    const sidSize = buf.readUInt32BE(off);
    off += 4;
    if (sidSize > 0 && sidSize < 100) {
      sessionId = buf.slice(off, off + sidSize).toString("utf8");
      off += sidSize;
    } else {
      // Not actually a session id — rewind (this happens for ConnectionStarted)
      off -= 4;
    }
  }

  const plSize = buf.readUInt32BE(off);
  off += 4;
  const payload = buf.slice(off, off + plSize);
  let payloadStr = serialization === SER_JSON ? payload.toString("utf8") : `<${payload.length} bytes raw>`;

  return { protoVer, msgType, flags, serialization, eventId, sessionId, payloadStr };
}

// ── Run

console.log("→ connecting", URL);
const ws = new WebSocket(URL, {
  headers: {
    "X-Api-App-ID": APP_ID,
    "X-Api-Access-Key": ACCESS_KEY,
    "X-Api-Resource-Id": RESOURCE_ID,
    "X-Api-App-Key": APP_KEY,
    "X-Api-Connect-Id": randomUUID(),
  },
});

const sessionId = randomUUID();
let step = 0;

const finish = (code) => {
  setTimeout(() => { try { ws.close(); } catch { /* ignore */ } process.exit(code); }, 500);
};

ws.on("upgrade", (res) => {
  console.log("← upgrade headers:");
  for (const [k, v] of Object.entries(res.headers)) {
    console.log(`    ${k}: ${v}`);
  }
});

ws.on("unexpected-response", (req, res) => {
  console.error(`✗ HTTP ${res.statusCode} ${res.statusMessage}`);
  console.error("response headers:");
  for (const [k, v] of Object.entries(res.headers)) {
    console.error(`    ${k}: ${v}`);
  }
  let body = "";
  res.on("data", (c) => { body += c.toString(); });
  res.on("end", () => {
    console.error("response body:", body || "(empty)");
    finish(1);
  });
});

ws.on("open", () => {
  console.log("← ws open");
  console.log("→ StartConnection (event 1)");
  ws.send(buildFrame({
    msgType: MSG_FULL_CLIENT, flags: FLAG_EVENT, serialization: SER_JSON,
    eventId: EVT_StartConnection, payload: "{}",
  }));
});

ws.on("message", (data) => {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const f = parseFrame(buf);
  console.log(`← frame: msgType=0b${f.msgType?.toString(2).padStart(4,"0")} event=${f.eventId} session=${f.sessionId || "-"} payload=${f.payloadStr}`);

  if (f.eventId === 50 /* ConnectionStarted */) {
    step = 1;
    console.log("→ StartSession (event 100)");
    const cfg = JSON.stringify({
      tts: { audio_config: { channel: 1, format: "pcm_s16le", sample_rate: 24000 } },
      dialog: { bot_name: "Stori", system_role: "测试用，不需要回复", extra: { model: "1.2.1.1" } },
    });
    ws.send(buildFrame({
      msgType: MSG_FULL_CLIENT, flags: FLAG_EVENT, serialization: SER_JSON,
      eventId: EVT_StartSession, sessionId, payload: cfg,
    }));
    return;
  }

  if (f.eventId === 150 /* SessionStarted */) {
    step = 2;
    console.log("✓ session up — closing immediately, no audio sent → 0 token");
    console.log("→ FinishSession (102)");
    ws.send(buildFrame({
      msgType: MSG_FULL_CLIENT, flags: FLAG_EVENT, serialization: SER_JSON,
      eventId: EVT_FinishSession, sessionId, payload: "{}",
    }));
    return;
  }

  if (f.eventId === 152 /* SessionFinished */) {
    step = 3;
    console.log("→ FinishConnection (2)");
    ws.send(buildFrame({
      msgType: MSG_FULL_CLIENT, flags: FLAG_EVENT, serialization: SER_JSON,
      eventId: EVT_FinishConnection, payload: "{}",
    }));
    return;
  }

  if (f.eventId === 52 /* ConnectionFinished */) {
    console.log("✓ clean shutdown");
    finish(0);
    return;
  }

  if (f.eventId === 51 || f.eventId === 153 || f.msgType === MSG_ERROR) {
    console.error("✗ failure event");
    finish(1);
  }
});

ws.on("close", (code, reason) => {
  console.log(`← close code=${code} reason=${reason}`);
});

ws.on("error", (err) => {
  console.error("✗ ws error:", err.message);
  finish(2);
});

setTimeout(() => {
  console.error(`✗ timeout at step ${step}`);
  finish(3);
}, 15000);

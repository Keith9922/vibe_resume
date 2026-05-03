// Stori voice relay — bridges browser WSS → 火山豆包端到端实时语音.
//
// Pattern lifted from Chinese Name Lab (server/server.mjs, but WS instead of HTTP):
// listen on 127.0.0.1 only, fronted by Cloudflare Named Tunnel which terminates
// HTTPS on a public hostname and forwards to localhost. Auth headers + Access
// Token never leave this process.
//
// Frame protocol is byte-for-byte pass-through in both directions. We don't
// parse the binary protocol byte-for-byte for forwarding, but we DO peek at
// JSON frames from the server to log transcripts (ASRResponse + ChatResponse)
// so the synthesise pipeline can later turn the conversation into resume cards.
//
// systemd unit: stori-voice-relay.service (see RELAY_DEPLOY.md)

import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { mkdirSync, appendFileSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT) || 3003;
const HOST = process.env.HOST || "127.0.0.1";

const VOLC_APP_ID = need("VOLC_APP_ID");
const VOLC_ACCESS_KEY = need("VOLC_ACCESS_KEY");
const VOLC_RESOURCE_ID = process.env.VOLC_RESOURCE_ID || "volc.speech.dialog";
const VOLC_APP_KEY = process.env.VOLC_APP_KEY || "PlgvMymc7f3tQnJ6";
const VOLC_WSS_URL = process.env.VOLC_WSS_URL || "wss://openspeech.bytedance.com/api/v3/realtime/dialogue";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = process.env.SESSIONS_DIR || resolve(__dirname, "sessions");
mkdirSync(SESSIONS_DIR, { recursive: true });

// Origin allowlist — same shape as Chinese Name Lab. Add your prod + preview hostnames.
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/optimistic-nobel-82972e\.vercel\.app$/,
  /^https:\/\/optimistic-nobel-82972e-[a-z0-9-]+\.vercel\.app$/,
  /^https:\/\/[a-z0-9-]+-keith9922s-projects\.vercel\.app$/,
  /^http:\/\/localhost:\d+$/,
];

function need(name) {
  const v = process.env[name]?.trim();
  if (!v) { console.error(`missing env ${name}`); process.exit(1); }
  return v;
}

function isOriginAllowed(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
}

// ── Transcript storage (one JSON-lines file per session) ────────────────
//
// Each line: {"ts": ms, "role": "user"|"assistant", "text": "..."}
// 7-day retention auto-cleanup on every connect.

function appendTranscript(sessionId, role, text) {
  if (!sessionId || !text) return;
  const safe = sessionId.replace(/[^a-zA-Z0-9-]/g, "");
  if (!safe) return;
  const line = JSON.stringify({ ts: Date.now(), role, text }) + "\n";
  try {
    appendFileSync(resolve(SESSIONS_DIR, safe + ".jsonl"), line, "utf8");
  } catch (err) {
    console.error(`[relay] transcript write failed:`, err.message);
  }
}

function readTranscript(sessionId) {
  const safe = sessionId.replace(/[^a-zA-Z0-9-]/g, "");
  if (!safe) return null;
  try {
    const raw = readFileSync(resolve(SESSIONS_DIR, safe + ".jsonl"), "utf8");
    return raw.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

function purgeOldSessions(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  try {
    const cutoff = Date.now() - maxAgeMs;
    for (const name of readdirSync(SESSIONS_DIR)) {
      const p = resolve(SESSIONS_DIR, name);
      try {
        if (statSync(p).mtimeMs < cutoff) unlinkSync(p);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

// ── Frame inspection (peek at server JSON frames to extract transcript) ──
//
// We forward bytes verbatim; we ALSO try to decode the few JSON frames we
// care about for the transcript log. Failures are silent — the user's audio
// path is unaffected.

const FLAG_EVENT = 0b0100;
const SER_JSON = 0b0001;
// volc event IDs we care about for transcript
const EVT_ASR_RESPONSE = 451;
const EVT_CHAT_RESPONSE = 550;
const EVT_CHAT_ENDED = 559;
const EVT_ASR_ENDED = 459;

function tryExtractTranscriptEvent(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null;
  const flags = buf[1] & 0xf;
  const ser = (buf[2] >> 4) & 0xf;
  if (!(flags & FLAG_EVENT) || ser !== SER_JSON) return null;
  const eventId = buf.readUInt32BE(4);
  if (eventId !== EVT_ASR_RESPONSE && eventId !== EVT_CHAT_RESPONSE
      && eventId !== EVT_CHAT_ENDED && eventId !== EVT_ASR_ENDED) return null;

  // Skip optional context_id field (most server frames have it)
  let off = 8;
  if (off + 4 <= buf.length) {
    const idSize = buf.readUInt32BE(off);
    if (idSize > 0 && idSize < 200 && off + 4 + idSize <= buf.length) {
      off += 4 + idSize;
    }
  }
  if (off + 4 > buf.length) return null;
  const plSize = buf.readUInt32BE(off);
  off += 4;
  if (off + plSize > buf.length) return null;

  try {
    const text = buf.slice(off, off + plSize).toString("utf8");
    return { eventId, payload: text ? JSON.parse(text) : {} };
  } catch {
    return null;
  }
}

// ── HTTP (health + transcript fetch) ─────────────────────────────────────

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }));
    return;
  }

  // GET /sessions/:id/transcript → JSON array of {ts, role, text}
  const m = url.pathname.match(/^\/sessions\/([a-zA-Z0-9-]+)\/transcript$/);
  if (m) {
    const origin = req.headers.origin;
    res.setHeader("Vary", "Origin");
    if (origin && isOriginAllowed(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.writeHead(204).end();
      return;
    }
    const transcript = readTranscript(m[1]);
    if (transcript === null) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid sessionId" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ sessionId: m[1], turns: transcript }));
    return;
  }

  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const origin = req.headers.origin;
  if (!isOriginAllowed(origin)) {
    console.warn(`[relay] reject upgrade — bad origin: ${origin}`);
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  if (!req.url?.startsWith("/voice")) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  // The browser passes ?session=<uuid> so we know which file to write to
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get("session") || randomUUID();
  wss.handleUpgrade(req, socket, head, (browser) => onConnection(browser, origin, sessionId));
});

// ── Per-connection: open upstream + bidirectional binary pass-through ────

function onConnection(browser, origin, sessionId) {
  const connectId = randomUUID();
  const tag = `[${connectId.slice(0, 8)} sess=${sessionId.slice(0, 8)}]`;
  console.log(`${tag} client connected from ${origin}`);
  purgeOldSessions(); // best-effort, runs on every connect, cheap

  const upstream = new WebSocket(VOLC_WSS_URL, {
    headers: {
      "X-Api-App-ID": VOLC_APP_ID,
      "X-Api-Access-Key": VOLC_ACCESS_KEY,
      "X-Api-Resource-Id": VOLC_RESOURCE_ID,
      "X-Api-App-Key": VOLC_APP_KEY,
      "X-Api-Connect-Id": connectId,
    },
  });

  let upstreamReady = false;
  const browserBuffer = [];
  // Per-turn buffers — finalise to transcript on ASREnded/ChatEnded
  let pendingUserText = "";
  let pendingAiText = "";

  const closeBoth = (code = 1000, reason = "") => {
    try { browser.close(code, reason); } catch { /* ignore */ }
    try { upstream.close(code, reason); } catch { /* ignore */ }
  };

  upstream.on("upgrade", (res) => {
    const logid = res.headers["x-tt-logid"];
    if (logid) console.log(`${tag} upstream upgrade x-tt-logid=${logid}`);
  });

  upstream.on("unexpected-response", (_req, res) => {
    let body = "";
    res.on("data", (c) => { body += c.toString(); });
    res.on("end", () => {
      console.error(`${tag} upstream HTTP ${res.statusCode}: ${body.slice(0, 200)}`);
      try { browser.send(JSON.stringify({ relayError: "upstream-http-" + res.statusCode })); } catch { /* ignore */ }
      closeBoth(1011, "upstream rejected");
    });
  });

  upstream.on("open", () => {
    upstreamReady = true;
    console.log(`${tag} upstream open — flushing ${browserBuffer.length} queued`);
    for (const msg of browserBuffer) {
      try { upstream.send(msg); } catch { /* ignore */ }
    }
    browserBuffer.length = 0;
  });

  upstream.on("message", (data, isBinary) => {
    // Forward to browser first — never let logging delay the audio path
    try { browser.send(data, { binary: isBinary }); } catch { /* ignore */ }

    // Best-effort transcript extraction (server JSON frames only)
    if (!isBinary && Buffer.isBuffer(data)) {
      const evt = tryExtractTranscriptEvent(data);
      if (!evt) return;
      try {
        if (evt.eventId === EVT_ASR_RESPONSE) {
          const r = evt.payload?.results?.[0];
          if (r && !r.is_interim && r.text) pendingUserText += r.text;
        } else if (evt.eventId === EVT_ASR_ENDED) {
          if (pendingUserText.trim()) appendTranscript(sessionId, "user", pendingUserText.trim());
          pendingUserText = "";
        } else if (evt.eventId === EVT_CHAT_RESPONSE) {
          const c = evt.payload?.content;
          if (typeof c === "string") pendingAiText += c;
        } else if (evt.eventId === EVT_CHAT_ENDED) {
          if (pendingAiText.trim()) appendTranscript(sessionId, "assistant", pendingAiText.trim());
          pendingAiText = "";
        }
      } catch (err) {
        console.warn(`${tag} transcript extract:`, err.message);
      }
    }
  });

  upstream.on("close", (code, reason) => {
    console.log(`${tag} upstream closed code=${code} reason=${reason}`);
    // Flush any remaining partial text (in case of abrupt close)
    if (pendingUserText.trim()) appendTranscript(sessionId, "user", pendingUserText.trim());
    if (pendingAiText.trim()) appendTranscript(sessionId, "assistant", pendingAiText.trim());
    closeBoth(code === 1006 ? 1011 : code, reason?.toString() || "");
  });

  upstream.on("error", (err) => {
    console.error(`${tag} upstream error: ${err.message}`);
    try { browser.send(JSON.stringify({ relayError: "upstream-" + err.message })); } catch { /* ignore */ }
    closeBoth(1011, "upstream error");
  });

  browser.on("message", (data, isBinary) => {
    if (!upstreamReady) {
      browserBuffer.push(data);
      return;
    }
    try { upstream.send(data, { binary: isBinary }); } catch { /* ignore */ }
  });

  browser.on("close", (code, reason) => {
    console.log(`${tag} client closed code=${code}`);
    closeBoth(code, reason?.toString() || "");
  });

  browser.on("error", (err) => {
    console.error(`${tag} client error: ${err.message}`);
    closeBoth(1011, "client error");
  });

  // Hard cap: any single voice session > 15 min closes. Safety against runaway billing.
  const lifecap = setTimeout(() => {
    console.warn(`${tag} 15 min cap hit — closing`);
    closeBoth(1000, "lifecap");
  }, 15 * 60 * 1000);
  upstream.on("close", () => clearTimeout(lifecap));
  browser.on("close", () => clearTimeout(lifecap));
}

// ── Boot ─────────────────────────────────────────────────────────────────

httpServer.listen(PORT, HOST, () => {
  console.log(`[relay] listening on ws://${HOST}:${PORT}/voice (health: /health)`);
  console.log(`[relay] upstream: ${VOLC_WSS_URL}`);
  console.log(`[relay] AppID: ${VOLC_APP_ID}, Resource: ${VOLC_RESOURCE_ID}`);
  console.log(`[relay] sessions dir: ${SESSIONS_DIR}`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[relay] ${sig} received, shutting down`);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

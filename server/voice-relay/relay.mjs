// Stori voice relay — bridges browser WSS → 火山豆包端到端实时语音.
//
// Pattern lifted from Chinese Name Lab (server/server.mjs, but WS instead of HTTP):
// listen on 127.0.0.1 only, fronted by Cloudflare Named Tunnel which terminates
// HTTPS on a public hostname and forwards to localhost. Auth headers + Access
// Token never leave this process.
//
// Frame protocol is byte-for-byte pass-through in both directions. We don't
// parse the binary protocol — that's the client's job. We only:
//   - require an origin from the allowlist (browser CORS-style enforcement)
//   - inject the 4 auth headers + connect-id when opening upstream
//   - close the pair atomically so neither side leaks
//
// systemd unit: stori-voice-relay.service (see RELAY_DEPLOY.md)

import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT) || 3003;
const HOST = process.env.HOST || "127.0.0.1";

const VOLC_APP_ID = need("VOLC_APP_ID");
const VOLC_ACCESS_KEY = need("VOLC_ACCESS_KEY");
const VOLC_RESOURCE_ID = process.env.VOLC_RESOURCE_ID || "volc.speech.dialog";
const VOLC_APP_KEY = process.env.VOLC_APP_KEY || "PlgvMymc7f3tQnJ6";
const VOLC_WSS_URL = process.env.VOLC_WSS_URL || "wss://openspeech.bytedance.com/api/v3/realtime/dialogue";

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

// ── HTTP server (just for /health + WS upgrade) ─────────────────────────

const httpServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }));
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
  wss.handleUpgrade(req, socket, head, (browser) => onConnection(browser, origin));
});

// ── Per-connection: open upstream + bidirectional binary pass-through ────

function onConnection(browser, origin) {
  const connectId = randomUUID();
  const tag = `[${connectId.slice(0, 8)}]`;
  console.log(`${tag} client connected from ${origin}`);

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
  const browserBuffer = []; // queue messages that arrived before upstream opened

  const closeBoth = (code = 1000, reason = "") => {
    try { browser.close(code, reason); } catch { /* ignore */ }
    try { upstream.close(code, reason); } catch { /* ignore */ }
  };

  // Track logid for ops debugging
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
    // Pass-through: server frames go straight to browser, binary stays binary
    try { browser.send(data, { binary: isBinary }); } catch { /* ignore */ }
  });

  upstream.on("close", (code, reason) => {
    console.log(`${tag} upstream closed code=${code} reason=${reason}`);
    closeBoth(code === 1006 ? 1011 : code, reason?.toString() || "");
  });

  upstream.on("error", (err) => {
    console.error(`${tag} upstream error: ${err.message}`);
    try { browser.send(JSON.stringify({ relayError: "upstream-" + err.message })); } catch { /* ignore */ }
    closeBoth(1011, "upstream error");
  });

  browser.on("message", (data, isBinary) => {
    // Client → server: queue until upstream is open, then pass-through
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
});

// Graceful shutdown
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`[relay] ${sig} received, shutting down`);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

import WebSocket from "ws";
import { randomUUID } from "node:crypto";

const URL = "wss://voice.zhangrg.top/voice";
console.log("→", URL);

const ws = new WebSocket(URL, {
  headers: { Origin: "https://optimistic-nobel-82972e.vercel.app" },
});

const sessionId = randomUUID();
let step = 0;

const buildFrame = ({ msgType, flags=0b0100, ser=0b0001, eventId, sessionId, payload="{}" }) => {
  const header = Buffer.from([
    (0b0001 << 4) | 0b0001,
    (msgType << 4) | flags,
    (ser << 4),
    0,
  ]);
  const parts = [header];
  if (flags & 0b0100) {
    const e = Buffer.alloc(4); e.writeUInt32BE(eventId, 0); parts.push(e);
  }
  if (sessionId) {
    const sid = Buffer.from(sessionId);
    const sz = Buffer.alloc(4); sz.writeUInt32BE(sid.length, 0); parts.push(sz, sid);
  }
  const pl = Buffer.from(payload);
  const sz = Buffer.alloc(4); sz.writeUInt32BE(pl.length, 0);
  parts.push(sz, pl);
  return Buffer.concat(parts);
};

const parseEvent = (buf) => {
  const flags = buf[1] & 0xf;
  if (!(flags & 0b0100)) return null;
  return buf.readUInt32BE(4);
};

ws.on("open", () => {
  console.log("← ws open");
  ws.send(buildFrame({ msgType: 0b0001, eventId: 1 }));
});

ws.on("message", (data) => {
  const eventId = parseEvent(data);
  console.log(`← event ${eventId}`);
  if (eventId === 50) {
    step = 1;
    const cfg = JSON.stringify({
      tts: { audio_config: { channel: 1, format: "pcm_s16le", sample_rate: 24000 }, extra: {} },
      asr: { extra: {} },
      dialog: { bot_name: "Stori", system_role: "测试", extra: { model: "1.2.1.1" } },
    });
    ws.send(buildFrame({ msgType: 0b0001, eventId: 100, sessionId, payload: cfg }));
    return;
  }
  if (eventId === 150) {
    step = 2;
    console.log("✓ session up — 0 token consumed");
    ws.send(buildFrame({ msgType: 0b0001, eventId: 102, sessionId, payload: "{}" }));
    return;
  }
  if (eventId === 152) {
    ws.send(buildFrame({ msgType: 0b0001, eventId: 2 }));
    return;
  }
  if (eventId === 52) {
    console.log("✓ clean");
    setTimeout(() => process.exit(0), 200);
  }
});

ws.on("error", (err) => { console.error("✗", err.message); process.exit(1); });
setTimeout(() => { console.error(`✗ timeout step=${step}`); process.exit(2); }, 15000);

# Stori Voice Relay

A tiny Node WebSocket server that proxies the browser to the **火山豆包端到端实时语音大模型** WSS endpoint. Mirrors the architecture used by `chinese_name_web/server/` (ink-name): listens on `127.0.0.1` only, exposed via Cloudflare Named Tunnel on a stable subdomain of `zhangrg.top`.

## Why a relay (and not direct from browser)

The volc WSS endpoint requires 4 auth headers including `X-Api-Access-Key`. Putting that in the browser leaks the account. Vercel serverless functions can't hold long-lived WebSocket connections (max 30s). So the only safe + workable place is a regular VM.

## Architecture

```
Browser (https://optimistic-nobel-82972e.vercel.app)
    │
    ▼  wss://voice.zhangrg.top/voice
Cloudflare (HTTPS terminates here, named tunnel)
    │  ┊
    ▼  ┊  cloudflared on 49.234 (outbound, no port forward)
stori-voice-relay on ws://127.0.0.1:3003/voice (this code)
    │
    ▼  wss + 4 auth headers (App-ID, Access-Key, Resource-Id, App-Key)
openspeech.bytedance.com/api/v3/realtime/dialogue
```

The relay is a **byte-for-byte pass-through**. It doesn't parse the binary protocol — that's the client's job. It only:
1. Enforces an origin allowlist (the same `*.vercel.app` pattern ink-name uses)
2. Injects the 4 auth headers when opening upstream
3. Atomically closes both ends if either side dies
4. Hard-caps any single session at 15 minutes (safety against runaway billing)

## Files

| | |
|---|---|
| `relay.mjs`     | the WebSocket server itself |
| `package.json`  | depends on `ws` + `bufferutil` (the latter avoids the silent WS handshake hang we hit before) |

## Deploy

```bash
# On the VM (Ubuntu 24.04, Node 20+):
mkdir -p /root/stori-voice-relay
# rsync this folder up:
rsync -av --delete server/voice-relay/ root@49.234.185.33:/root/stori-voice-relay/
ssh root@49.234.185.33 'cd /root/stori-voice-relay && npm install --omit=dev'

# Create env file:
ssh root@49.234.185.33 'cat > /root/stori-voice-relay/.env <<E
PORT=3003
HOST=127.0.0.1
VOLC_APP_ID=6441977331
VOLC_ACCESS_KEY=BrWjwh91mrCILp...
VOLC_RESOURCE_ID=volc.speech.dialog
VOLC_APP_KEY=PlgvMymc7f3tQnJ6
VOLC_WSS_URL=wss://openspeech.bytedance.com/api/v3/realtime/dialogue
E
chmod 600 /root/stori-voice-relay/.env'

# Install systemd unit:
scp server/voice-relay/stori-voice-relay.service root@49.234.185.33:/etc/systemd/system/
ssh root@49.234.185.33 'systemctl daemon-reload && systemctl enable --now stori-voice-relay'
```

## Cloudflare Tunnel — adding `voice.zhangrg.top`

Two paths depending on what's quicker for you (no `cert.pem` on the VM, so the
CLI `tunnel create` route is blocked).

### Path A — dashboard (3 clicks)

1. https://one.dash.cloudflare.com → Networks → Tunnels → Create tunnel (Cloudflared)
2. Name it `stori-voice` → save → copy the **install token** (NOT the install command)
3. Public Hostname tab → Add: subdomain `voice` / domain `zhangrg.top` / service `HTTP` `localhost:3003`
4. Drop the install token into `/root/.cloudflared/stori-voice-token` (mode 600)
5. Install systemd unit `stori-voice-tunnel.service` (template below) + enable

### Path B — fully automated via API token

If you've still got the CF API token used for ink-name, give me:
- API token (Tunnel:Edit + DNS:Edit)
- account_id
- zone_id for zhangrg.top

I run the same 4 curl commands the ink-name README documents.

### Tunnel systemd unit

Same shape as `ink-name-tunnel.service`, just renamed:

```ini
[Unit]
Description=Stori Voice Cloudflare Named Tunnel (voice.zhangrg.top)
After=network.target stori-voice-relay.service
Requires=stori-voice-relay.service

[Service]
Type=simple
ExecStart=/bin/sh -c 'exec /usr/bin/cloudflared --no-autoupdate tunnel --metrics 127.0.0.1:0 run --token $(cat /root/.cloudflared/stori-voice-token)'
Restart=on-failure
RestartSec=10
StandardOutput=append:/var/log/stori-voice-tunnel.log
StandardError=append:/var/log/stori-voice-tunnel.log

[Install]
WantedBy=multi-user.target
```

## Env vars

| | |
|---|---|
| `PORT` | default 3003 (3001/3002/8080 already taken on this box) |
| `HOST` | default 127.0.0.1 (cloudflared talks to localhost) |
| `VOLC_APP_ID` | required — numeric, e.g. `6441977331` |
| `VOLC_ACCESS_KEY` | required — Access Token (NOT the UUID-format API Key) |
| `VOLC_RESOURCE_ID` | default `volc.speech.dialog` |
| `VOLC_APP_KEY` | default `PlgvMymc7f3tQnJ6` (public constant, not a secret) |
| `VOLC_WSS_URL` | default `wss://openspeech.bytedance.com/api/v3/realtime/dialogue` |

## Verify

```bash
# health check
curl -s https://voice.zhangrg.top/health | jq

# tail logs
ssh root@49.234.185.33 'tail -f /var/log/stori-voice-relay.log'
```

## Cost guardrails

The relay imposes a hard 15-minute lifecap on any single connection. Combined with the 100万 token free quota (~30 min of balanced dialogue), this means a single runaway session can burn at most ~50% of the free quota.

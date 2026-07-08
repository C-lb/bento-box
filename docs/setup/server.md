# Bento server runbook (Oracle ARM VM + Docker + cloudflared)

Bento runs as a Docker image (`Dockerfile`) behind a Cloudflare Tunnel sidecar (`docker-compose.yml`). No inbound ports are opened on the VM — cloudflared makes an outbound connection to Cloudflare and the tunnel publishes it to a hostname. Everything below targets Oracle Cloud's Always Free Ampere A1 tier (arm64), which matches the image (built and health-checked on arm64 via colima locally before this doc was written).

## 1. Oracle Cloud: Always Free Ampere A1 instance

- Sign up at oracle.com/cloud/free (needs a credit card for verification, Always Free resources don't charge).
- Create Instance → shape: `VM.Standard.A1.Flex` (Ampere, arm64) → Always Free eligible sizing (up to 4 OCPU / 24GB on the free tier).
- Image: **Ubuntu 24.04** (arm64).
- Networking: leave the default VCN, but **do not open any ingress rules** beyond SSH (22) — the app is reached only through the Cloudflare Tunnel, not a public port.
- Add your SSH key at creation; note the public IP for the SSH step below.

## 2. Install Docker + compose plugin

SSH in, then:

```sh
ssh ubuntu@<instance-ip>
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
docker compose version   # confirms the compose plugin is present
```

## 3. Clone the repo and configure env

```sh
git clone https://github.com/C-lb/event-editor.git
cd event-editor
cp .env.server.example .env.server
```

Edit `.env.server` and fill in:

- `EE_AUTH_PASSCODE` — the passcode gating the app (leave unset only for local/throwaway testing; set it here for anything reachable over the internet).
- `EE_AUTH_SECRET` — generate with `openssl rand -hex 32`.
- `CLOUDFLARE_TUNNEL_TOKEN` — from step 4.
- Optional AI tool keys (`ANTHROPIC_API_KEY`, `GROQ_API_KEY`, etc.) — same names as the repo-root `.env` used in local dev.

`.env.server` is gitignored; it never leaves the VM.

## 4. Cloudflare Zero Trust: create the tunnel

- Cloudflare dashboard → Zero Trust → Networks → Tunnels → Create a tunnel (Cloudflared type).
- Name it (e.g. `bento-prod`), copy the install command's token (the long string after `--token`) — that's `CLOUDFLARE_TUNNEL_TOKEN`.
- Public Hostname tab → add a hostname (e.g. `bento.yourdomain.com`) → Service: `HTTP`, URL: `http://bento:3000` (the compose service name resolves inside the tunnel's Docker network — not `localhost`).
- Save. Cloudflare auto-provisions the DNS record.

## 5. Bring it up

```sh
docker compose up -d --build
docker compose ps        # both bento and tunnel should be Up (bento shows "healthy" once /api/health passes)
```

First boot runs core's DB migrations automatically (idempotent — safe on every restart) before the server starts; watch `docker compose logs bento` for `migrated /data/app.db` followed by `Ready in <n>ms`.

## 6. Verify

```sh
curl https://bento.yourdomain.com/api/health
```

Expect `{"ok":true,"deps":[{"id":"ffmpeg","ready":true},{"id":"ytdlp","ready":true,...},{"id":"libreoffice","ready":true}]}`. If any dep is `ready:false`, check `docker compose logs bento` — see the Dockerfile comments for where each binary lives (`ffmpeg-static`/`ffprobe-static` npm packages, `/usr/local/bin/yt-dlp`, `/usr/bin/soffice` from `libreoffice-impress`).

## 7. Updating

```sh
cd event-editor
git pull
docker compose up -d --build
```

Compose rebuilds only the changed layers and restarts `bento` with the same `bento-data` volume (DB, thumbnails, downloaded binaries all persist). `tunnel` is untouched unless its image changed.

## ⚠️ Upload size limit through the tunnel

The app enforces its own upload caps (2 GB for video/splice, 500 MB for audio), but every request
to the tunnel-published hostname passes through Cloudflare's edge first. **Cloudflare's free plan
rejects request bodies over 100 MB there** — the request never reaches the app; the client gets an
HTML error page instead of JSON. In practice this means the in-app caps only hold below 100 MB;
the headline mobile use case (compress a large phone video) will not work through the tunnel as
currently documented for anything bigger.

This is a Cloudflare edge constraint, not a Bento bug, and there's no single right fix — pick
based on what you're optimizing for:

- **Upgrade the Cloudflare plan** (Pro and above raise the body-size limit well past 100 MB).
  Simplest, costs money, keeps the current zero-open-ports architecture.
- **Expose the app port directly** behind the VM's firewall with an IP allowlist instead of routing
  through the tunnel. Removes the Cloudflare edge from the upload path entirely; requires opening
  an ingress rule and trusting the allowlist instead of the tunnel's zero-inbound-ports model.
- **Tailscale Funnel** (or a similar WireGuard-based tunnel) as a swap-in for cloudflared. No
  documented 100 MB body cap, but it's a different operational surface to set up and maintain.
- **Split large uploads client-side** (chunked upload) so no single request body crosses 100 MB.
  Keeps the current tunnel/architecture as-is but is real client + server work, not yet built.

Caleb's call — none of the above is wired up; this is a known limit, not a fix.

## 8. Fallback: always-on Mac instead of Oracle

If the Oracle free tier instance isn't available or gets reclaimed, the same compose file runs unmodified on any always-on Mac with Docker Desktop:

```sh
git clone https://github.com/C-lb/event-editor.git
cd event-editor
cp .env.server.example .env.server   # fill in as step 3 above
docker compose up -d --build
```

Steps 4, 6, 7 are identical — the tunnel and health check don't care what's running Docker underneath. Docker Desktop's arm64/Apple Silicon build is a drop-in for the Oracle Ampere arm64 image (same base architecture); on an Intel Mac, Docker will emulate or you can drop `--platform` pinning if it's ever added (it isn't currently — the Dockerfile has no explicit `--platform`, so it builds native to whatever host runs it).

# syntax=docker/dockerfile:1

# Odyssey voice-agent image (LiveKit Node worker) — mirrors services/voice-host/Dockerfile.
#
# BUILD CONTEXT = monorepo root. In Railway, set this service's Root Directory to
# the repo root and the Dockerfile path to `services/voice-agent/Dockerfile`, so
# npm workspaces and the onnxruntime-node native libs resolve from the hoisted
# root node_modules.
#
# No build step: runs via tsx (matching voice-host + worker:wiki-ingest); the
# @odyssey/* packages export raw TS.
FROM node:22-slim

# rtc-node's NATIVE engine does its own TLS to LiveKit Cloud (the region fetch on
# room-join). Node's own HTTPS has a bundled CA store (so worker registration
# works), but the native Rust client uses the SYSTEM store — which can be missing
# or unfound in a slim image, surfacing as "error sending request". Install the CA
# bundle, refresh it, and point native TLS (OpenSSL) at it explicitly.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    SSL_CERT_DIR=/etc/ssl/certs

# bge (transformers.js) caches models under $HOME; pin HOME so the build-time
# warmup and the runtime process resolve the SAME baked cache and boot never
# pays the HuggingFace download.
# PORT (not HEALTH_PORT) so Railway can override it at runtime and its /healthz
# probe reaches the worker — agent.ts binds `HEALTH_PORT ?? PORT ?? 8080`. Do NOT
# set HEALTH_PORT in the Railway variables, or it would pin the bind off $PORT.
ENV HOME=/app \
    HF_HOME=/app/.cache/huggingface \
    NODE_ENV=production \
    PORT=8080

# onnxruntime-node's postinstall downloads CUDA EP binaries from a Microsoft CDN
# on linux/x64 — useless on this CPU-only host and a build-breaking network
# dependency (ETIMEDOUT kills `npm ci`). The CPU binaries are bundled in the npm
# package; skip the download. The prewarm below still smoke-tests the dlopen path.
ENV ONNXRUNTIME_NODE_INSTALL=skip

WORKDIR /app

# Copies sources plus every workspace package.json (npm ci needs them all present
# to reconcile the lockfile). The root .dockerignore strips node_modules/.next/.git.
COPY . .
RUN npm ci

# Pre-bake the bge model into the image AND smoke-test the native dlopen path
# (onnxruntime-node under node:22-slim glibc). Fails the build if bge can't load.
# HF_TOKEN (set as a Railway service variable → auto-exposed as a build arg):
# HuggingFace 403s anonymous downloads from shared cloud-builder IPs; transformers.js
# sends the token as a Bearer header when present. Scoped to this RUN, not ENV, so
# it isn't baked into the runtime image.
ARG HF_TOKEN
RUN HF_TOKEN=$HF_TOKEN npm run -w @odyssey/voice-agent prewarm

EXPOSE 8080
# Runtime env (Railway): LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET.
# Leave EMBEDDING_PROVIDER unset → warm in-process bge.
# "start" tells the @livekit/agents CLI to run in production worker mode.
#
# node is PID 1 ON PURPOSE (no npm wrapper): the @livekit/agents CLI drains on
# SIGTERM — stops taking new rooms, finishes active sessions — but only if the
# signal actually reaches node. `npm run` as PID 1 swallows/mishandles TERM, so
# deploy swaps were hard-killing live conversations mid-turn. Pair with a
# generous RAILWAY_DEPLOYMENT_DRAINING_SECONDS (e.g. 300) on the service so
# Railway waits for the drain instead of SIGKILLing after the default grace.
CMD ["node", "--import", "tsx", "services/voice-agent/src/agent.ts", "start"]

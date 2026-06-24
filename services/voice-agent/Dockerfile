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

WORKDIR /app

# Copies sources plus every workspace package.json (npm ci needs them all present
# to reconcile the lockfile). The root .dockerignore strips node_modules/.next/.git.
COPY . .
RUN npm ci

# Pre-bake the bge model into the image AND smoke-test the native dlopen path
# (onnxruntime-node under node:22-slim glibc). Fails the build if bge can't load.
RUN npm run -w @odyssey/voice-agent prewarm

EXPOSE 8080
# Runtime env (Railway): LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET.
# Leave EMBEDDING_PROVIDER unset → warm in-process bge.
# "start" tells the @livekit/agents CLI to run in production worker mode.
CMD ["npm", "run", "agent:voice", "--", "start"]

# syntax=docker/dockerfile:1

# Warm voice-host image.
#
# BUILD CONTEXT = monorepo root. In Railway, set this service's Root Directory
# to the repo root and the Dockerfile path to `services/voice-host/Dockerfile`,
# so npm workspaces and the onnxruntime-node native libs resolve from the
# hoisted root node_modules.
#
# No build step: the service runs via tsx (matching `worker:wiki-ingest`), and
# the @odyssey/* packages export raw TS.
FROM node:22-slim

# bge (transformers.js) caches models under $HOME; pin HOME so the build-time
# warmup and the runtime process resolve the SAME baked cache and boot never
# pays the HuggingFace download.
ENV HOME=/app \
    HF_HOME=/app/.cache/huggingface \
    NODE_ENV=production \
    PORT=8080

WORKDIR /app

# The root .dockerignore strips node_modules/.next/.git, so this copies sources
# plus every workspace package.json (npm ci needs them all present to reconcile
# the lockfile). Full workspace install — slim later with `turbo prune` if the
# image size matters.
COPY . .
RUN npm ci

# Pre-bake the bge model into the image AND smoke-test the native dlopen path
# (onnxruntime-node under node:22-slim glibc). Fails the build if the warm
# embedder can't load or run.
RUN npm run -w @odyssey/voice-host prewarm

EXPOSE 8080
# Leave EMBEDDING_PROVIDER unset → the pipeline uses warm in-process bge.
CMD ["npm", "run", "host:voice"]

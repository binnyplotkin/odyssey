# Pandora's Box

Pandora's Box is a Vercel-ready Next.js application for voice-first AI simulations. Phase 1 ships a reusable engine that supports structured worlds, dynamic event generation, explicit state tracking, resumable sessions, and a minimal web client with chat fallback.

## Stack

- Next.js 16 App Router
- Tailwind CSS v4
- Neon Postgres with Drizzle ORM
- OpenAI for text, speech-to-text, and text-to-speech
- Vitest for engine tests

## What is implemented

- A generic simulation model for worlds, roles, factions, characters, relationships, and event templates
- A reference world pack, `The King`, built on monarchy and governance dynamics
- A turn-processing pipeline:
  - ingest text or voice transcript
  - enforce policy guardrails
  - select a plausible event
  - update structured world state
  - generate narration and NPC responses
  - persist sessions and turn logs
- API routes for worlds, sessions, turns, speech transcription, and speech synthesis
- Neon-backed persistence with an in-memory fallback when `DATABASE_URL` is absent
- A Tailwind-based browser UI for starting a world, issuing turns, seeing transcript output, and watching state meters change

## Project structure

```text
src/app                 App Router pages and API routes
src/components          Client UI
src/data/worlds         Structured world definitions
src/lib/db              Neon + Drizzle persistence
src/lib/simulation      Engine services and adapters
src/types               Domain schemas and types
```

## Environment

Create `.env.local` with:

```bash
DATABASE_URL=postgresql://user:password@your-neon-endpoint/pandoras_box?sslmode=require
OPENAI_API_KEY=sk-...
```

If `DATABASE_URL` is missing, the app falls back to in-memory persistence.

If `OPENAI_API_KEY` is missing, the app still runs with deterministic fallback narration/dialogue generation and disables real OpenAI STT/TTS behavior.

## Development

Install dependencies and start the app:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Database

Generate or push the Drizzle schema:

```bash
npm run db:generate
npm run db:push
```

The schema lives in [`src/lib/db/schema.ts`](/Users/joshsassoon/Documents/pandoras-box/src/lib/db/schema.ts).

## Test and build

```bash
npm run lint
npm run test
npm run build
```

## Notes

- The current voice button uses browser speech recognition when available and keeps text as a first-class fallback.
- OpenAI is the Phase 1 audio provider. ElevenLabs is intentionally deferred until the simulation loop is stable and the product needs more cinematic voice rendering.
- The app is structured to deploy on Vercel, but Neon and OpenAI credentials must be configured in the Vercel project environment before production use.

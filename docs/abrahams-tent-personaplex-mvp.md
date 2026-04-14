# Abraham's Tent — PersonaPlex MVP Project Scope

## Overview

Abraham's Tent is the first playable demo of the Odyssey platform — an audio-first, open-ended interactive simulation where the player is a wandering traveler entering Abraham's tent in ancient Canaan (~1800 BCE). The core differentiator is **NVIDIA PersonaPlex**: real-time, full-duplex speech-to-speech AI that lets players have natural voice conversations with biblical characters, each with a distinct voice and personality.

PersonaPlex is a 7B-parameter end-to-end model (not a pipeline of ASR → LLM → TTS). It handles interruptions, backchanneling, overlapping speech, and rapid turn-taking natively with ~200ms latency.

---

## Architecture

### Current State (Built)

The following has already been implemented using the existing ElevenLabs/OpenAI pipeline:

| Component | Status | Location |
|-----------|--------|----------|
| World definition (6 characters, 4 metrics, 6 events) | Done | `apps/admin/src/data/worlds/abrahams-tent.ts` |
| World registration + voice archetypes | Done | `apps/admin/src/data/worlds/index.ts`, `packages/engine/src/voice-mapping.ts` |
| State reducer (hospitality/trust/tension/revelation) | Done | `packages/engine/src/state-reducer.ts` |
| TTS route (ElevenLabs + OpenAI fallback) | Done | `apps/admin/src/app/api/audio/speak/route.ts` |
| STT route (OpenAI Whisper) | Done | `apps/admin/src/app/api/audio/transcribe/route.ts` |
| Entry screen (3 paths: preset/guided/open) | Done | `apps/admin/src/app/abrahams-tent/page.tsx` |
| Simulation console (push-to-talk, transcript, idle timer) | Done | `apps/admin/src/components/abrahams-tent-console.tsx` |
| Session page + sidebar nav | Done | `apps/admin/src/app/abrahams-tent/[sessionId]/page.tsx` |

### Target State (PersonaPlex Integration)

```
┌──────────────────────────────────────────────────────────┐
│  Browser (Admin App)                                      │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Abraham's Tent Console                               │ │
│  │                                                       │ │
│  │  Mic → Opus encoder → WebSocket ──────────────────┐  │ │
│  │                                                    │  │ │
│  │  Speaker ← Opus decoder ← WebSocket ←──────────┐  │  │ │
│  │                                                 │  │  │ │
│  │  Transcript panel (text tokens from WS)         │  │  │ │
│  │  Character presence indicators                  │  │  │ │
│  │  Waveform visualization (AnalyserNode)          │  │  │ │
│  └─────────────────────────────────────────────────┘  │  │ │
└───────────────────────────────────────────────────────┘  │ │
                                                           │ │
┌───────────────────────────────────────────────────────┐  │ │
│  Admin App Server (Next.js)                            │  │ │
│                                                        │  │ │
│  WebSocket proxy route ←──────────────────────────────┘  │ │
│    • Authenticates session                                │ │
│    • Routes to correct PersonaPlex instance                │ │
│    • Intercepts text tokens for engine state updates       │ │
│                                                           │ │
│  Engine turn processor (async, parallel)                   │ │
│    • Receives transcript text from WS text tokens          │ │
│    • Updates metrics, fires events, tracks state           │ │
│    • Sends state updates back to console                   │ │
└───────────────────────────────────────────────────────────┘ │
                                                              │
┌──────────────────────────────────────────────────────────┐  │
│  PersonaPlex Server(s) (GPU)                              │  │
│                                                           │  │
│  Instance per active persona:                             │  │
│    • abraham-instance  (NATM1.pt + Abraham text prompt)   │  │
│    • sarah-instance    (NATF0.pt + Sarah text prompt)     │  │
│    • eliezer-instance  (NATM2.pt + Eliezer text prompt)   │  │
│    • narrator-instance (NATM0.pt + Narrator text prompt)  │  │
│    ...                                                    │  │
│                                                           │  │
│  Port 8998 per instance (or multiplexed via router)       │  │
│  WSS endpoint: /api/chat                                  │  │
└──────────────────────────────────────────────────────────┘
```

---

## PersonaPlex Constraints

These constraints shape every architectural decision:

| Constraint | Impact |
|-----------|--------|
| **No mid-session persona switching** | Persona (voice + text prompt) is locked at WebSocket connection time. Character changes require disconnect/reconnect. |
| **Single concurrent session per server** | Each active character conversation needs its own PersonaPlex instance or a queue system. |
| **GPU required** | A100 80GB tested; H100 supported. ~20-40GB VRAM per instance. |
| **18 pre-built voices** | 8 natural (NATF0-3, NATM0-3) + 10 variety (VARF0-4, VARM0-4). No documented custom voice creation. |
| **Binary WebSocket protocol** | Opus audio at 24kHz. Type-byte header: 0x00=handshake, 0x01=audio, 0x02=text, 0x03=control, 0x04=metadata, 0x05=error, 0x06=ping. |
| **10-second inactivity timeout** | Server auto-disconnects after 10s silence. Client must send keepalive pings. |
| **Self-signed SSL** | Server generates temp certs. Production needs proper TLS termination. |
| **HuggingFace gated model** | Requires HF_TOKEN and license acceptance for `nvidia/personaplex-7b-v1`. |

---

## Persona Design

### Character → Voice Mapping

| Character | Voice File | Rationale |
|-----------|-----------|-----------|
| **Narrator** | `NATM0.pt` | Deepest natural male voice — authoritative, clear |
| **Abraham** | `NATM1.pt` | Warm, fatherly natural male |
| **Sarah** | `NATF0.pt` | Sharp, mature natural female |
| **Isaac** | `VARF1.pt` | Bright variety female (closest to child register) |
| **Eliezer** | `NATM2.pt` | Steady, quiet natural male |
| **Michael** | `VARM0.pt` | Ethereal variety male — slightly otherworldly |
| **Melchizedek** | `NATM3.pt` | Rich, deep natural male |

### Text Prompts (System Prompts)

Each character gets a text prompt passed as the `text_prompt` query parameter at connection time. These encode personality, speaking style, world context, and behavioral rules.

**Example — Abraham:**
```
You are Abraham, patriarch of a household near the oaks of Mamre in ancient Canaan.
You sit at the entrance of your tent in the heat of the day, watching for travelers.
You welcome every stranger as though they might be an angel. You speak in an unhurried,
deep voice. You favor questions over answers, parables over arguments, and silence over
confrontation. You carry the weight of a covenant with God — a promise of descendants
as numerous as the stars — but you hold it lightly in conversation. You are warm but
not casual. You have seen much and forgotten little. When asked about your past, you
speak of crossing the river, leaving your father's house, the binding you do not name.
You are currently hosting a wandering traveler who has just arrived at your tent.
```

**Example — Sarah:**
```
You are Sarah, wife of Abraham and matriarch of the household. You are perceptive, dry,
and occasionally laugh at the wrong moment. You watch guests from behind the curtain
before deciding whether to speak. Your humor hides tenderness. You have heard every
promise before and watched how they land. You speak sharply but not cruelly. You see
things faster than Abraham does. When the subject of the promise comes up — a child,
an heir, the impossible — you may laugh. You did once. You are speaking with a
traveler who has arrived at Abraham's tent.
```

Each character's full text prompt will be derived from their world definition fields: `backstory`, `speakingStyle`, `dialogueExamples`, `motivations`, and `behaviorTriggers`.

---

## Phases

### Phase 0 — Infrastructure Setup

**Goal:** PersonaPlex server running and reachable from the dev machine.

#### 0.1 GPU Provisioning
- **Option A (Cloud):** Provision an A100 or H100 instance (RunPod, Lambda Labs, AWS p4d/p5, or NVIDIA NGC)
- **Option B (Local):** If an NVIDIA GPU with 24GB+ VRAM is available locally
- **Decision needed:** Cloud vs local, single GPU vs multi-GPU

#### 0.2 PersonaPlex Server Setup
- Accept HuggingFace license for `nvidia/personaplex-7b-v1`
- Set `HF_TOKEN` environment variable
- **Docker route (recommended):**
  ```bash
  git clone https://github.com/NVIDIA/personaplex.git
  cd personaplex
  echo "HF_TOKEN=hf_..." > .env
  docker compose up
  ```
- **Direct Python route:**
  ```bash
  cd personaplex
  pip install moshi/.
  SSL_DIR=$(mktemp -d)
  python -m moshi.server --ssl "$SSL_DIR" --port 8998
  ```
- Verify server starts and WebSocket is reachable at `wss://<host>:8998/api/chat`

#### 0.3 Connectivity Test
- Use the PersonaPlex reference client (`/client` dir in the repo) to verify end-to-end voice conversation
- Test with a simple text prompt and one of the `.pt` voice files
- Measure latency from dev machine to server
- **Deliverable:** Confirmed round-trip voice conversation with PersonaPlex

#### 0.4 Network Configuration
- If cloud: Set up SSH tunnel or reverse proxy for WSS access
- Configure TLS termination (nginx/caddy in front of PersonaPlex)
- Ensure the admin app can reach the PersonaPlex endpoint
- Store PersonaPlex host URL in `.env`: `PERSONAPLEX_WS_URL=wss://...`

**Estimated effort:** 1-2 days (mostly provisioning and debugging GPU/Docker setup)

---

### Phase 1 — Single-Persona Proof of Concept

**Goal:** Browser mic → PersonaPlex → browser speaker, with Abraham as the persona. No engine integration yet.

#### 1.1 PersonaPlex Client Library
**Create: `packages/engine/src/personaplex/client.ts`**

TypeScript WebSocket client that implements the PersonaPlex binary protocol:

```typescript
type PersonaPlexConfig = {
  serverUrl: string;           // wss://host:8998/api/chat
  textPrompt: string;          // character system prompt
  voicePrompt: string;         // e.g., "NATM1.pt"
  textTemperature?: number;
  audioTemperature?: number;
  textTopk?: number;
  audioTopk?: number;
};

type PersonaPlexEvents = {
  onAudio: (opusFrame: Uint8Array) => void;
  onText: (token: string) => void;
  onError: (error: string) => void;
  onConnected: () => void;
  onDisconnected: () => void;
};

class PersonaPlexClient {
  connect(config: PersonaPlexConfig, events: PersonaPlexEvents): void;
  sendAudio(opusFrame: Uint8Array): void;
  sendControl(control: 'start' | 'endTurn' | 'pause' | 'restart'): void;
  ping(): void;
  disconnect(): void;
  get connected(): boolean;
}
```

Key implementation details:
- Binary message framing (type byte + payload)
- Opus audio at 24kHz
- Auto-ping every 5 seconds to prevent 10s timeout
- Reconnection logic with backoff

#### 1.2 WebSocket Proxy Route
**Create: `apps/admin/src/app/api/personaplex/route.ts`**

Next.js route handler that upgrades to WebSocket and proxies between browser and PersonaPlex server. This intermediary allows:
- Session authentication
- Text token interception (for engine state updates)
- Persona routing (which character instance to connect to)

**Alternative approach:** If Next.js WebSocket support is limited, create a standalone WebSocket proxy server in `packages/engine/src/personaplex/proxy.ts` that runs alongside the Next.js dev server.

#### 1.3 Browser Audio Pipeline
**Modify: `apps/admin/src/components/abrahams-tent-console.tsx`**

Replace the push-to-talk → REST STT/TTS flow with a streaming WebSocket flow:

```
Current:  Hold mic → MediaRecorder → base64 → POST /transcribe → text → POST /turn → POST /speak → play
Target:   Open mic → Opus encoder → WebSocket frames → PersonaPlex → Opus frames back → decode → play
```

Key changes:
- Replace `MediaRecorder` with `AudioWorklet` for real-time Opus encoding at 24kHz
- Open WebSocket connection on session start
- Stream mic audio as binary frames continuously (full-duplex)
- Receive and decode Opus audio frames for playback
- Receive text tokens for live transcript display
- Wire playback audio through `AnalyserNode` for waveform visualization

#### 1.4 Opus Codec in Browser
- Use `libopus` via WebAssembly (e.g., `opus-recorder` or `libopus.js`)
- Encode mic input: PCM 24kHz mono → Opus frames
- Decode server output: Opus frames → PCM → AudioContext playback

**Deliverable:** Open the console, speak to Abraham via PersonaPlex, hear his response in real-time with ~200ms latency. No engine state tracking yet.

**Estimated effort:** 3-5 days

---

### Phase 2 — Engine Integration

**Goal:** PersonaPlex conversations update the simulation state (metrics, events, character presence) in real-time.

#### 2.1 Text Token Interceptor
**Create: `packages/engine/src/personaplex/text-interceptor.ts`**

Accumulates text tokens from PersonaPlex's `0x02` messages into complete utterances. Detects sentence boundaries and triggers engine state updates asynchronously.

```typescript
class TextInterceptor {
  // Accumulates tokens, fires callback on sentence completion
  onToken(token: string): void;
  onSentenceComplete: (sentence: string, speaker: string) => void;
  flush(): void;
}
```

#### 2.2 Async State Updater
**Create: `packages/engine/src/personaplex/state-updater.ts`**

Runs the existing turn processing pipeline (state reducer, event selector) in the background as PersonaPlex conversations proceed. Does NOT block the audio stream.

```typescript
class AsyncStateUpdater {
  constructor(sessionId: string, worldDefinition: WorldDefinition);

  // Called when a player utterance is detected
  onPlayerUtterance(text: string): Promise<StateUpdate>;

  // Called when a character response is detected
  onCharacterResponse(characterId: string, text: string): void;

  // Returns current state for UI
  getVisibleState(): VisibleState;

  // Returns events that should fire
  getPendingEvents(): EventTemplate[];
}
```

This decouples the simulation engine from the audio pipeline — PersonaPlex handles the conversation, the engine tracks what's happening narratively.

#### 2.3 Event-Driven Character Arrival
When the engine detects an event should fire (e.g., `guest-approaches` when trust > 25), the console needs to:
1. Receive the event notification
2. Disconnect from the current persona's PersonaPlex instance
3. Play a narrator transition (via a narrator PersonaPlex instance or fallback TTS)
4. Connect to the new character's PersonaPlex instance
5. Resume conversation with the new character

This is the hardest UX challenge given PersonaPlex's no-mid-session-switching constraint.

**Design decision:** Two approaches:

**Option A — Sequential Persona (Simpler)**
- One PersonaPlex connection at a time
- Character switches involve a brief transition (~2-3 seconds)
- Narrator bridges transitions with ElevenLabs TTS (existing pipeline)
- Player talks to one character at a time

**Option B — Parallel Personas (Richer, needs multi-GPU)**
- Multiple PersonaPlex instances running simultaneously
- Audio routing layer switches which instance receives mic input
- Multiple characters can respond in sequence within a turn
- Requires one GPU per active character

**Recommendation for MVP:** Option A with narrator bridging.

#### 2.4 Metrics & Transcript Sync
- Text interceptor feeds player utterances to the state reducer
- State reducer updates metrics (hospitality, trust, tension, revelation)
- Metric values pushed to console UI via Server-Sent Events or WebSocket sideband
- Transcript panel shows accumulated text tokens from PersonaPlex

**Deliverable:** Full conversation with Abraham updates metrics. When trust > 25, a narrator transition plays and a new character arrives.

**Estimated effort:** 4-6 days

---

### Phase 3 — Multi-Character & Narrator

**Goal:** Smooth transitions between characters. Narrator frames scene changes.

#### 3.1 Persona Pool Manager
**Create: `packages/engine/src/personaplex/persona-manager.ts`**

Manages the lifecycle of PersonaPlex connections for all active personas:

```typescript
class PersonaPoolManager {
  // Pre-warm a persona connection (optional, reduces switch latency)
  warmUp(characterId: string): Promise<void>;

  // Switch active persona — disconnects current, connects new
  switchTo(characterId: string): Promise<void>;

  // Get current active persona
  get activePersona(): string;

  // Send audio to active persona
  sendAudio(opusFrame: Uint8Array): void;

  // Shutdown all connections
  dispose(): void;
}
```

Character-to-PersonaPlex config mapping:
```typescript
const PERSONA_CONFIGS: Record<string, { voicePrompt: string; textPrompt: string }> = {
  narrator: { voicePrompt: "NATM0.pt", textPrompt: "..." },
  abraham:  { voicePrompt: "NATM1.pt", textPrompt: "..." },
  sarah:    { voicePrompt: "NATF0.pt", textPrompt: "..." },
  // ...
};
```

#### 3.2 Narrator Transitions
When the engine fires a scene event:
1. Pause player mic input
2. Switch to narrator persona (or use ElevenLabs fallback)
3. Generate and play narrator transition text
4. Switch to new character persona
5. Resume player mic input

Transition narration can be pre-generated from event `narratorPrompt` fields or generated live via PersonaPlex narrator persona.

#### 3.3 Character Presence & Idle Handling
- Character presence indicators update when personas switch
- Idle timer (already built) sends ambient narration via narrator persona
- Extended absence (3+ min) gracefully suspends the session

#### 3.4 Ending Flow
- When the engine detects `the-departure` event conditions, trigger final narrator sequence
- Play farewell narration
- Disconnect all PersonaPlex instances
- Show "Leave the Tent" UI

**Deliverable:** Full multi-character experience — player enters, talks to Abraham, Sarah arrives, conversation deepens, angels may reveal, farewell plays.

**Estimated effort:** 3-5 days

---

### Phase 4 — Polish & Production Readiness

#### 4.1 Waveform Visualization
- Adapt the existing voice-test-4 3D waveform (Three.js/R3F) with warm desert palette
- Feed PersonaPlex audio playback through `AnalyserNode`
- Ambient idle animation when no audio is active

#### 4.2 Connection Resilience
- WebSocket reconnection with exponential backoff
- Graceful degradation: fall back to ElevenLabs/OpenAI pipeline if PersonaPlex is unreachable
- Connection status indicator in console UI
- Handle PersonaPlex 10-second timeout (auto-ping, reconnect)

#### 4.3 Latency Optimization
- Pre-warm next likely character connection based on metric thresholds
- Opus codec tuning (bitrate, frame size)
- Audio buffer sizing for smooth playback without gaps

#### 4.4 Entry Screen Integration
- Entry screen creates session, stores player backstory
- First PersonaPlex interaction opens with player introducing themselves
- Abraham's initial response sets the tone

#### 4.5 Prompt Tuning
- Iterate on character text prompts for personality accuracy
- Test voice file assignments — swap .pt files to find best character match
- Tune event trigger thresholds for good pacing
- Test idle handling behavior

**Estimated effort:** 3-4 days

---

## GPU Infrastructure Options

| Option | Cost | Latency | Setup |
|--------|------|---------|-------|
| **RunPod A100 80GB** | ~$1.50/hr on-demand | 10-50ms (US regions) | Easiest, template-based |
| **Lambda Labs A100** | ~$1.10/hr | 10-50ms | Simple, SSH access |
| **AWS p4d.24xlarge** (8x A100) | ~$32/hr (could run 8 personas) | 5-20ms | Complex setup, overkill for MVP |
| **NVIDIA NGC** | Varies | Lowest | Native NVIDIA ecosystem |
| **Local RTX 4090 (24GB)** | One-time ~$1,600 | <5ms | May need `--cpu-offload` |

**Recommendation for MVP:** RunPod or Lambda Labs single A100. Start with one instance, expand to 2-3 for multi-character if needed.

**Multi-character GPU math:**
- 1 GPU = 1 active persona at a time (sequential switching)
- 2 GPUs = narrator + 1 character simultaneously
- 3 GPUs = narrator + 2 characters (covers most scenes)

---

## File Plan

### New Files

| File | Purpose | Est. Lines |
|------|---------|------------|
| `packages/engine/src/personaplex/client.ts` | WebSocket client for PersonaPlex binary protocol | ~200 |
| `packages/engine/src/personaplex/text-interceptor.ts` | Accumulates text tokens into utterances | ~80 |
| `packages/engine/src/personaplex/state-updater.ts` | Async engine state updates from conversation | ~150 |
| `packages/engine/src/personaplex/persona-manager.ts` | Manages persona connections and switching | ~200 |
| `packages/engine/src/personaplex/types.ts` | Shared types for PersonaPlex integration | ~50 |
| `packages/engine/src/personaplex/index.ts` | Package exports | ~15 |
| `apps/admin/src/app/api/personaplex/route.ts` | WebSocket proxy route (or standalone proxy) | ~120 |
| `apps/admin/src/lib/opus-worklet.ts` | AudioWorklet for real-time Opus encode/decode | ~100 |

### Modified Files

| File | Changes |
|------|---------|
| `apps/admin/src/components/abrahams-tent-console.tsx` | Replace REST audio pipeline with WebSocket streaming, add persona switching |
| `apps/admin/src/app/abrahams-tent/page.tsx` | Add PersonaPlex connection config to session startup |
| `packages/engine/src/index.ts` | Export PersonaPlex modules |
| `.env.example` | Add `PERSONAPLEX_WS_URL`, `HF_TOKEN` |

### Infrastructure Files

| File | Purpose |
|------|---------|
| `infra/personaplex/docker-compose.yml` | PersonaPlex server deployment config |
| `infra/personaplex/nginx.conf` | TLS termination + WebSocket proxy |
| `infra/personaplex/.env.example` | Server environment template |

---

## Timeline

| Phase | Duration | Dependency |
|-------|----------|------------|
| **Phase 0: Infrastructure** | 1-2 days | GPU access |
| **Phase 1: Single-Persona PoC** | 3-5 days | Phase 0 |
| **Phase 2: Engine Integration** | 4-6 days | Phase 1 |
| **Phase 3: Multi-Character** | 3-5 days | Phase 2 |
| **Phase 4: Polish** | 3-4 days | Phase 3 |
| **Total** | **14-22 days** | |

---

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| PersonaPlex latency too high from cloud GPU | Medium | Test early in Phase 0; consider local GPU |
| Character voice quality insufficient with preset .pt files | Medium | Test all 18 voices early; worst case, use ElevenLabs for some characters |
| Multi-character switching feels jarring (2-3s gap) | High | Narrator bridging, pre-warming connections, ambient audio during transitions |
| Single-GPU can't handle concurrent personas | Certain | Sequential switching for MVP; multi-GPU for post-MVP |
| PersonaPlex model goes off-character | Medium | Strong text prompts, behavioral guardrails in prompt, engine-side safety policy |
| Browser Opus codec compatibility | Low | Well-supported via WebAssembly; fallback to raw PCM if needed |

---

## Fallback Strategy

If PersonaPlex proves impractical for the MVP (GPU cost, latency, quality), the existing ElevenLabs/OpenAI pipeline is fully built and functional. The simulation console, entry screen, engine integration, and all world data work with the REST-based pipeline today. PersonaPlex can be added incrementally — even a single character (Abraham) running on PersonaPlex while others use ElevenLabs would be a compelling demo.

---

## Decision Points (Need Input)

1. **GPU provisioning:** Cloud (RunPod/Lambda) or local? Budget?
2. **Multi-character approach:** Sequential switching (1 GPU) or parallel personas (multi-GPU)?
3. **Narrator strategy:** PersonaPlex narrator persona or keep ElevenLabs for narration?
4. **Custom voice embeddings:** Invest time in creating custom .pt files, or use the 18 presets?
5. **Deployment target:** Dev-only demo or publicly accessible?

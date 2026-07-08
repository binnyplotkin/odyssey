"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { buildSpeakerTurnRequest, createInitialSceneState, resolveSceneDecision, } from "@odyssey/orchestration/client";
import { SceneAudioBus } from "./scene-audio-bus";
const RECENT_TURNS_LIMIT = 8;
export function useScenePlayer(opts) {
    var _a, _b;
    const { scene, sessionId } = opts;
    const generateTurnId = (_a = opts.generateTurnId) !== null && _a !== void 0 ? _a : (() => crypto.randomUUID());
    const [phase, setPhase] = useState("idle");
    const [turns, setTurns] = useState([]);
    const [traces, setTraces] = useState([]);
    const [currentSpeakerSlug, setCurrentSpeakerSlug] = useState(null);
    const [error, setError] = useState(null);
    const [sceneState, setSceneState] = useState(() => (Object.assign({}, createInitialSceneState(scene))));
    // Refs that mirror state for use inside the async loop. State setters
    // are async w.r.t. when the next loop iteration reads them, so we keep
    // a ref shadow for the runner's own consumption.
    const sceneStateRef = useRef(sceneState);
    const turnsRef = useRef(turns);
    const busRef = useRef(null);
    const runningRef = useRef(false);
    const voiceStreamAbortRef = useRef(null);
    const loopGenerationRef = useRef(0);
    useEffect(() => {
        sceneStateRef.current = sceneState;
    }, [sceneState]);
    useEffect(() => {
        turnsRef.current = turns;
    }, [turns]);
    const ensureBus = useCallback(() => {
        if (!busRef.current)
            busRef.current = new SceneAudioBus();
        busRef.current.start();
        return busRef.current;
    }, []);
    const pushTurn = useCallback((turn) => {
        setTurns((prev) => [...prev, turn]);
        turnsRef.current = [...turnsRef.current, turn];
    }, []);
    const pushTrace = useCallback((trace) => {
        if (!trace)
            return;
        setTraces((prev) => [...prev.slice(-49), trace]);
    }, []);
    const applyDecision = useCallback((decision, newSpeakerSlug) => {
        setSceneState((prev) => {
            const resolved = resolveSceneDecision({ scene, sceneState: prev }, decision);
            const next = Object.assign(Object.assign({}, resolved.sceneState), { lastSpeakerSlug: newSpeakerSlug !== null && newSpeakerSlug !== void 0 ? newSpeakerSlug : resolved.sceneState.lastSpeakerSlug });
            sceneStateRef.current = next;
            return next;
        });
    }, [scene]);
    /** One iteration of the orchestration loop. Returns when control is
     *  handed back to the user (action: wait-for-user / end-scene) or the
     *  runner is stopped. */
    const tick = useCallback(async (generation, lastUserMessage) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        if (!runningRef.current)
            return;
        if (generation !== loopGenerationRef.current)
            return;
        try {
            setPhase("deciding");
            const orchestratorResult = await fetchOrchestratorDecision({
                sessionId,
                sceneId: scene.id,
                sceneState: sceneStateRef.current,
                recentTurns: turnsRef.current
                    .slice(-RECENT_TURNS_LIMIT)
                    .map((t) => ({
                    speakerSlug: t.speakerSlug,
                    speakerName: t.speakerName,
                    text: t.text,
                })),
                lastUserMessage,
            });
            const decision = orchestratorResult.decision;
            pushTrace({
                id: crypto.randomUUID(),
                kind: "orchestrator",
                at: new Date().toISOString(),
                trace: orchestratorResult.trace,
                meta: {
                    sessionId,
                    sceneId: scene.id,
                    action: decision.action,
                    speakerSlug: decision.action === "speak" ? (_a = decision.speakerId) !== null && _a !== void 0 ? _a : null : null,
                    provider: (_c = (_b = orchestratorResult.orchestrator) === null || _b === void 0 ? void 0 : _b.provider) !== null && _c !== void 0 ? _c : null,
                    model: (_e = (_d = orchestratorResult.orchestrator) === null || _d === void 0 ? void 0 : _d.model) !== null && _e !== void 0 ? _e : null,
                    degraded: (_f = orchestratorResult.degraded) !== null && _f !== void 0 ? _f : false,
                    reason: (_g = orchestratorResult.reason) !== null && _g !== void 0 ? _g : null,
                },
            });
            if (!runningRef.current || generation !== loopGenerationRef.current)
                return;
            // Apply ambience change first so the audio bed matches whatever
            // happens next (speak/narrate/wait).
            const bus = ensureBus();
            if (decision.ambience !== undefined) {
                bus.setAmbience(decision.ambience);
            }
            if (decision.action === "wait-for-user") {
                applyDecision(decision, null);
                setCurrentSpeakerSlug(null);
                setPhase("waiting-for-user");
                return;
            }
            if (decision.action === "end-scene") {
                applyDecision(decision, null);
                setCurrentSpeakerSlug(null);
                setPhase("idle");
                runningRef.current = false;
                return;
            }
            if (decision.action === "narrate") {
                const text = (_h = decision.narration) === null || _h === void 0 ? void 0 : _h.trim();
                if (!text) {
                    // Skip an empty narrate and re-decide.
                    applyDecision(decision, null);
                    return tick(generation);
                }
                const turnId = generateTurnId();
                setCurrentSpeakerSlug("narrator");
                setPhase("narrating");
                pushTurn({ id: turnId, speakerSlug: "narrator", text });
                const narration = await playNarration(bus, text, (_j = scene.narratorVoice) !== null && _j !== void 0 ? _j : scene.characters[0].voice);
                void persistSceneTurn({
                    sessionId,
                    turnId,
                    inputMode: "narration",
                    speakerSlug: "narrator",
                    assistantText: text,
                    provider: (_k = narration.provider) !== null && _k !== void 0 ? _k : null,
                    status: "completed",
                    audioMetrics: narration.audioMetrics,
                    metadata: { source: "scene-player", voiceId: narration.voiceId },
                });
                if (!runningRef.current || generation !== loopGenerationRef.current)
                    return;
                applyDecision(decision, "narrator");
                return tick(generation);
            }
            if (decision.action === "speak") {
                const speakerRequest = buildSpeakerTurnRequest({
                    scene,
                    sceneState: sceneStateRef.current,
                    decision,
                    recentTurns: turnsRef.current,
                });
                if (!speakerRequest) {
                    applyDecision(decision, null);
                    return tick(generation);
                }
                setCurrentSpeakerSlug(speakerRequest.characterSlug);
                setPhase("speaking");
                const voiceResult = await streamCharacterVoice({
                    bus,
                    sessionId,
                    turnId: generateTurnId(),
                    speakerRequest,
                    voiceStreamAbortRef,
                });
                pushTrace(voiceResult.trace);
                if (!runningRef.current || generation !== loopGenerationRef.current)
                    return;
                pushTurn({
                    speakerSlug: speakerRequest.characterSlug,
                    speakerName: speakerRequest.speakerName,
                    text: voiceResult.text,
                });
                applyDecision(decision, speakerRequest.characterSlug);
                return tick(generation);
            }
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[scene-runner] tick failed", message);
            if (generation === loopGenerationRef.current) {
                setError(message);
                setPhase("error");
                runningRef.current = false;
            }
        }
    }, [sessionId, scene, applyDecision, pushTurn, pushTrace, ensureBus, generateTurnId]);
    const start = useCallback(async () => {
        setError(null);
        ensureBus(); // satisfies user-gesture rule
        runningRef.current = true;
        loopGenerationRef.current += 1;
        const generation = loopGenerationRef.current;
        await tick(generation);
    }, [ensureBus, tick]);
    const sendUserMessage = useCallback(async (text, options) => {
        var _a, _b, _c;
        const trimmed = text.trim();
        if (!trimmed)
            return;
        // Barge-in: kill any in-flight character audio and the underlying
        // voice-stream fetch, then push the user's turn and re-enter the
        // loop. Bumping the generation invalidates any in-flight tick.
        (_a = voiceStreamAbortRef.current) === null || _a === void 0 ? void 0 : _a.abort();
        (_b = busRef.current) === null || _b === void 0 ? void 0 : _b.stopVoice();
        loopGenerationRef.current += 1;
        const generation = loopGenerationRef.current;
        const turnId = (_c = options === null || options === void 0 ? void 0 : options.turnId) !== null && _c !== void 0 ? _c : generateTurnId();
        runningRef.current = true;
        ensureBus();
        pushTurn({ id: turnId, speakerSlug: "user", speakerName: "You", text: trimmed });
        void persistSceneTurn({
            sessionId,
            turnId,
            inputMode: "text",
            speakerSlug: "user",
            userText: trimmed,
            status: "completed",
            metadata: { source: "scene-player" },
        });
        await tick(generation, trimmed);
    }, [ensureBus, generateTurnId, pushTurn, sessionId, tick]);
    const stop = useCallback(() => {
        var _a, _b, _c;
        runningRef.current = false;
        loopGenerationRef.current += 1;
        (_a = voiceStreamAbortRef.current) === null || _a === void 0 ? void 0 : _a.abort();
        (_b = busRef.current) === null || _b === void 0 ? void 0 : _b.stopVoice();
        (_c = busRef.current) === null || _c === void 0 ? void 0 : _c.setAmbience(null);
        setPhase("idle");
        setCurrentSpeakerSlug(null);
    }, []);
    useEffect(() => {
        return () => {
            var _a, _b, _c;
            runningRef.current = false;
            (_a = voiceStreamAbortRef.current) === null || _a === void 0 ? void 0 : _a.abort();
            (_b = busRef.current) === null || _b === void 0 ? void 0 : _b.stopVoice();
            (_c = busRef.current) === null || _c === void 0 ? void 0 : _c.setAmbience(null);
        };
    }, []);
    return {
        phase,
        sceneState,
        turns,
        traces,
        latestTrace: (_b = traces[traces.length - 1]) !== null && _b !== void 0 ? _b : null,
        currentSpeakerSlug,
        error,
        start,
        sendUserMessage,
        stop,
    };
}
async function fetchOrchestratorDecision(input) {
    var _a;
    const resp = await fetch(`/api/scene-sessions/${encodeURIComponent(input.sessionId)}/orchestrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            sceneId: input.sceneId,
            sceneState: input.sceneState,
            recentTurns: input.recentTurns,
            lastUserMessage: input.lastUserMessage,
        }),
    });
    if (!resp.ok) {
        const detail = await resp.text().catch(() => "");
        throw new Error(`orchestrate ${resp.status}: ${detail.slice(0, 200)}`);
    }
    const payload = (await resp.json());
    if (payload.degraded) {
        console.warn("[scene-runner] orchestrator degraded:", payload.reason);
    }
    return Object.assign(Object.assign({}, payload), { trace: (_a = payload.trace) !== null && _a !== void 0 ? _a : {
            startedAt: new Date().toISOString(),
            elapsedMs: 0,
            events: [],
        } });
}
/* ── Voice-stream consumer ─────────────────────────────────────────── */
async function streamCharacterVoice(args) {
    var _a, _b, _c, _d, _e;
    const controller = new AbortController();
    args.voiceStreamAbortRef.current = controller;
    const resp = await fetch(`/api/characters/${encodeURIComponent(args.speakerRequest.characterSlug)}/voice-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            sessionId: args.sessionId,
            turnId: args.turnId,
            message: args.speakerRequest.message,
            history: args.speakerRequest.history,
            promptChunk: args.speakerRequest.promptChunk,
            voice: args.speakerRequest.voiceSlug,
        }),
        signal: controller.signal,
    });
    if (!resp.ok || !resp.body) {
        const detail = await resp.text().catch(() => "");
        throw new Error(`voice-stream ${resp.status}: ${detail.slice(0, 200)}`);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let replyText = "";
    let latestServerTrace = null;
    let donePayload = null;
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        let frameEnd;
        while ((frameEnd = buffer.indexOf("\n\n")) !== -1) {
            const raw = buffer.slice(0, frameEnd);
            buffer = buffer.slice(frameEnd + 2);
            let eventName = null;
            let dataLine = "";
            for (const line of raw.split("\n")) {
                if (line.startsWith("event: "))
                    eventName = line.slice(7).trim();
                else if (line.startsWith("data: "))
                    dataLine += line.slice(6);
            }
            if (!eventName || !dataLine)
                continue;
            if (eventName === "trace") {
                latestServerTrace = JSON.parse(dataLine);
            }
            else if (eventName === "token") {
                const payload = JSON.parse(dataLine);
                if (payload.delta)
                    replyText += payload.delta;
            }
            else if (eventName === "audio") {
                const payload = JSON.parse(dataLine);
                const samples = SceneAudioBus.decodeFloat32Base64(payload.pcm);
                args.bus.enqueueVoiceFrame(samples, payload.sampleRate);
            }
            else if (eventName === "done") {
                donePayload = JSON.parse(dataLine);
                if (donePayload === null || donePayload === void 0 ? void 0 : donePayload.serverTrace)
                    latestServerTrace = donePayload.serverTrace;
            }
            else if (eventName === "error") {
                const payload = JSON.parse(dataLine);
                throw new Error(`voice-stream error: ${(_a = payload.message) !== null && _a !== void 0 ? _a : "unknown"}`);
            }
        }
    }
    // Wait for the audio bus to fully drain before resolving so the next
    // tick doesn't overlap with this speaker's tail.
    await args.bus.voiceDrained();
    if (args.voiceStreamAbortRef.current === controller) {
        args.voiceStreamAbortRef.current = null;
    }
    return {
        text: replyText.trim(),
        trace: latestServerTrace
            ? {
                id: args.turnId,
                kind: "voice",
                at: new Date().toISOString(),
                trace: latestServerTrace,
                meta: {
                    sessionId: args.sessionId,
                    turnId: args.turnId,
                    speakerSlug: args.speakerRequest.characterSlug,
                    provider: (_b = donePayload === null || donePayload === void 0 ? void 0 : donePayload.provider) !== null && _b !== void 0 ? _b : null,
                    model: (_c = donePayload === null || donePayload === void 0 ? void 0 : donePayload.model) !== null && _c !== void 0 ? _c : null,
                    firstAudioMs: (_d = donePayload === null || donePayload === void 0 ? void 0 : donePayload.firstAudioMs) !== null && _d !== void 0 ? _d : null,
                    totalMs: (_e = donePayload === null || donePayload === void 0 ? void 0 : donePayload.totalMs) !== null && _e !== void 0 ? _e : null,
                },
            }
            : null,
    };
}
/* ── Narrator ──────────────────────────────────────────────────────── */
async function playNarration(bus, text, voiceId) {
    var _a, _b, _c, _d, _e;
    // Narration routes through /api/scenes/narrate, which resolves a library
    // voice id through the SAME streaming TTS pipeline characters use (PCM
    // frames played via the SceneAudioBus voice track), or falls back to batch
    // OpenAI TTS (mp3) for bare voice names / unconfigured voices.
    const resp = await fetch("/api/scenes/narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voiceId }),
    });
    if (!resp.ok) {
        const detail = await resp.text().catch(() => "");
        throw new Error(`narrator ${resp.status}: ${detail.slice(0, 200)}`);
    }
    const payload = (await resp.json());
    if (payload.kind === "pcm") {
        // Same playback path as character voice — feed frames into the bus's
        // voice track and wait for it to drain before the loop advances.
        for (const frame of payload.frames) {
            bus.enqueueVoiceFrame(SceneAudioBus.decodeFloat32Base64(frame.pcm), frame.sampleRate);
        }
        await bus.voiceDrained();
        const sampleRate = (_b = (_a = payload.frames[0]) === null || _a === void 0 ? void 0 : _a.sampleRate) !== null && _b !== void 0 ? _b : null;
        const audioSamples = payload.frames.reduce((sum, frame) => sum + SceneAudioBus.decodeFloat32Base64(frame.pcm).length, 0);
        return {
            provider: (_c = payload.provider) !== null && _c !== void 0 ? _c : null,
            voiceId,
            audioMetrics: {
                kind: "pcm",
                sampleRate,
                audioSamples,
                durationMs: sampleRate && audioSamples
                    ? Math.round((audioSamples / sampleRate) * 1000)
                    : null,
                frameCount: payload.frames.length,
            },
        };
    }
    if (!payload.audioBase64) {
        throw new Error("narrator returned no audio");
    }
    await new Promise((resolve, reject) => {
        var _a;
        const audio = new Audio(`data:${(_a = payload.mimeType) !== null && _a !== void 0 ? _a : "audio/mpeg"};base64,${payload.audioBase64}`);
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("narrator audio playback failed"));
        audio.play().catch(reject);
    });
    return {
        provider: (_d = payload.provider) !== null && _d !== void 0 ? _d : "openai",
        voiceId,
        audioMetrics: {
            kind: "mp3",
            mimeType: (_e = payload.mimeType) !== null && _e !== void 0 ? _e : "audio/mpeg",
            byteSize: payload.audioBase64.length,
        },
    };
}
async function persistSceneTurn(input) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    await fetch(`/api/scene-sessions/${encodeURIComponent(input.sessionId)}/turns/${encodeURIComponent(input.turnId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            inputMode: input.inputMode,
            speakerSlug: input.speakerSlug,
            userText: (_a = input.userText) !== null && _a !== void 0 ? _a : null,
            assistantText: (_b = input.assistantText) !== null && _b !== void 0 ? _b : null,
            provider: (_c = input.provider) !== null && _c !== void 0 ? _c : null,
            model: (_d = input.model) !== null && _d !== void 0 ? _d : null,
            status: input.status,
            completedAt: new Date().toISOString(),
            tokenUsage: (_e = input.tokenUsage) !== null && _e !== void 0 ? _e : {},
            audioMetrics: (_f = input.audioMetrics) !== null && _f !== void 0 ? _f : {},
            latencySummary: (_g = input.latencySummary) !== null && _g !== void 0 ? _g : {},
            trace: (_h = input.trace) !== null && _h !== void 0 ? _h : {},
            metadata: (_j = input.metadata) !== null && _j !== void 0 ? _j : {},
        }),
    }).catch((err) => {
        console.warn("[scene-player] turn persistence failed", err);
    });
}

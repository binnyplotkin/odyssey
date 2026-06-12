# Sonar real recordings

Real recorded utterances for the `real-endpointing` suite — the **fair**
cutoff evaluation for turn detection. Synthetic TTS pauses understate the
benefit of semantic endpointing: a TTS clip fragment like "I was wondering"
carries falsely-complete *falling* intonation, whereas a real mid-sentence
pause keeps rising/continuing prosody. Only real audio measures whether a
semantic endpointer (Smart Turn v3) actually holds a pause that fixed-silence
would cut.

## How to add recordings

1. See what to record:
   ```bash
   npm run sonar -- recordings --suite real-endpointing
   ```
2. Record each clip as a **mono WAV** (any sample rate — Sonar resamples to
   24kHz) and save it here as `<name>.wav` (e.g. `pause-01.wav`).
   - **complete-\*** — say it naturally and stop. Should stay one turn.
   - **pause-\*** — say the first half, pause mid-thought for ~1–1.5s
     **without letting your pitch fall** (as if you're about to continue),
     then finish. A fixed-silence endpointer cuts these; a good semantic one
     holds them.
3. Run the eval against a local audio-rt (no admin cookie / dev server
   needed):
   ```bash
   # baseline (fixed silence)
   npm run sonar -- run --suite real-endpointing --audio-rt-ws ws://127.0.0.1:8089/api/asr-streaming \
     --label "real · fixed-silence"
   # with Smart Turn (restart the gateway with SMART_TURN_ENABLED=1 first)
   npm run sonar -- run --suite real-endpointing --audio-rt-ws ws://127.0.0.1:8089/api/asr-streaming \
     --label "real · smart-turn 0.5"
   npm run sonar -- report --suite real-endpointing
   ```

The `cutoff` column is the headline: how often a paused utterance was chopped
into two turns. Fixed-silence should be high; Smart Turn should be much lower
— and on *real* audio, more convincingly than on synthetic fixtures.

## Git

The `.wav` files are gitignored (they're your voice). The scripts to record
live in the `real-endpointing` suite in
[`packages/sonar/src/suites.ts`](../../../packages/sonar/src/suites.ts), so the
eval is reproducible by anyone who records the same lines. Commit the WAVs
yourself if you want a shared, fixed eval set.

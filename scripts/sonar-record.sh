#!/usr/bin/env bash
# Guided recorder for the Sonar `real-endpointing` eval.
#
# Walks through each clip: press Enter to start, speak, press Enter to stop.
# Saves mono 24kHz WAVs straight to evals/sonar/recordings/<name>.wav.
#
# Usage:
#   AUDIO_DEV=2 scripts/sonar-record.sh            # record all (device 2 = MacBook mic)
#   AUDIO_DEV=1 scripts/sonar-record.sh pause-03   # re-record one clip (AirPods)
#
# Find your device index with:
#   ffmpeg -f avfoundation -list_devices true -i ""
# First run will trigger a macOS mic-permission prompt for your terminal.

set -uo pipefail   # not -e: a single clip's hiccup shouldn't abort the run
cd "$(dirname "$0")/.."
OUT="evals/sonar/recordings"
DEV="${AUDIO_DEV:-2}"
SECS="${CLIP_SECS:-12}"   # auto-stop safety; you'll usually stop sooner with 'q'
mkdir -p "$OUT"

# name|kind|what to say (⟂ marks where to pause mid-sentence)
CLIPS=(
  "complete-01|complete|Tell me about the visitors at Mamre."
  "complete-02|complete|What did Sarah make of their promise?"
  "complete-03|complete|Peace be with you, friend."
  "pause-01|pause|Tell me about ⟂(pause ~1s) the visitors who came to your tent at Mamre."
  "pause-02|pause|I was wondering ⟂(pause ~1s) what you remember of your journey from Ur."
  "pause-03|pause|And Sarah — ⟂(pause ~1s) did she ever doubt the promise would come to pass?"
  "pause-04|pause|Hmm ⟂(pause ~1s) let me think about how to ask this."
  "pause-05|pause|So when you ⟂(pause ~1.5s) when you left Haran, were you afraid?"
  "pause-06|pause|The thing is ⟂(pause ~1.5s) I don't really know where to begin."
)

record_one() {
  local name="$1" kind="$2" script="$3"
  echo ""
  echo "──────────────────────────────────────────────────────────────"
  echo "  $name   [$kind]"
  echo "  Say:  $script"
  if [ "$kind" = "pause" ]; then
    echo "  ↑ At ⟂, hesitate mid-thought — keep your pitch UP (like you'll"
    echo "    continue), don't let it fall as if finishing."
  fi
  read -r -p "  ▶︎ Press Enter to START…" _
  echo "  ● recording — speak, then press  q  (it stops cleanly; auto-stops at ${SECS}s)"
  # Foreground ffmpeg; 'q' on stdin makes it finalize the WAV properly.
  # -t is a safety cap so a missed 'q' can't hang. Do NOT use Ctrl-C — it
  # corrupts the trailer.
  ffmpeg -hide_banner -loglevel error -f avfoundation -i ":$DEV" \
    -t "$SECS" -ar 24000 -ac 1 -y "$OUT/$name.wav" || true
  if [ -s "$OUT/$name.wav" ]; then
    echo "  ✓ saved $OUT/$name.wav"
  else
    echo "  ✗ FAILED (empty) — re-run: AUDIO_DEV=$DEV scripts/sonar-record.sh $name"
  fi
}

# Optional single-clip mode: pass a clip name to re-record just that one.
if [ "${1:-}" != "" ]; then
  for c in "${CLIPS[@]}"; do
    IFS='|' read -r name kind script <<<"$c"
    [ "$name" = "$1" ] && { record_one "$name" "$kind" "$script"; exit 0; }
  done
  echo "Unknown clip '$1'. Names: complete-01..03, pause-01..06"; exit 1
fi

echo "Recording ${#CLIPS[@]} clips to $OUT (device :$DEV)."
echo "Re-record any later with: AUDIO_DEV=$DEV scripts/sonar-record.sh <name>"
for c in "${CLIPS[@]}"; do
  IFS='|' read -r name kind script <<<"$c"
  record_one "$name" "$kind" "$script"
done
echo ""
echo "All done. Check: npm run sonar -- recordings --suite real-endpointing"

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/* ── Palette ──────────────────────────────────────────────────── */

const C = {
  bg: "#0F0A06",
  panel: "#1A120B",
  panelHover: "#241A10",
  border: "#2E2015",
  borderActive: "#D4A574",
  text: "#F4E4C1",
  muted: "#8B7355",
  accent: "#D4A574",
  accentGlow: "#FF6B35",
  deep: "#1A0F0A",
};

/* ── Presets ───────────────────────────────────────────────────── */

const PRESETS = [
  {
    id: "refugee",
    title: "The Refugee",
    backstory:
      "I am a refugee fleeing Sodom. The smoke still clings to my clothing. I seek Abraham's protection — I have nowhere else to go.",
    goal: "Find shelter and safety in Abraham's household.",
  },
  {
    id: "merchant",
    title: "The Merchant",
    backstory:
      "I am a merchant from the east, traveling the king's road with spices and bronze. I have heard of a wealthy man who keeps an open tent. I come to trade — and perhaps to learn why.",
    goal: "Strike a deal, but understand what makes this household different.",
  },
  {
    id: "emissary",
    title: "The Emissary",
    backstory:
      "I carry a message from the king of Gerar. Abraham's growing influence has drawn attention. I am here to assess whether he is an ally or a threat.",
    goal: "Report back on Abraham's strength, intentions, and the nature of his God.",
  },
  {
    id: "seeker",
    title: "The Seeker",
    backstory:
      "I have left my family's gods behind. I heard a rumor on the road — a man who speaks to the One God, who left everything on a promise. I need to know if it's true.",
    goal: "Find out whether Abraham's faith is real, and whether it could be yours.",
  },
];

/* ── Guided prompts ───────────────────────────────────────────── */

const GUIDED_PROMPTS = [
  { label: "Where are you from?", placeholder: "A city beyond the river... a village in the hills... I've been walking so long I've forgotten..." },
  { label: "What drives you?", placeholder: "I need something I can't name... I lost someone... I heard a rumor about this tent..." },
  { label: "What did you leave behind?", placeholder: "My father's house... a debt... a god I no longer believe in..." },
];

/* ── Entry Screen ─────────────────────────────────────────────── */

export default function AbrahamsTentEntry() {
  const router = useRouter();
  const [tab, setTab] = useState<"preset" | "guided" | "open">("preset");
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [guidedAnswers, setGuidedAnswers] = useState(["", "", ""]);
  const [guidedStep, setGuidedStep] = useState(0);
  const [loading, setLoading] = useState(false);

  async function startSession(firstTurnText: string) {
    setLoading(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worldId: "abrahams-tent", roleId: "wanderer" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create session");
      const sessionId = data.session?.id;
      if (!sessionId) throw new Error("No session ID returned");

      // Store the first turn text so the session page can submit it
      sessionStorage.setItem(`tent-intro-${sessionId}`, firstTurnText);
      router.push(`/abrahams-tent/${sessionId}`);
    } catch (err) {
      setLoading(false);
      alert(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  const presetEntry = PRESETS.find((p) => p.id === selectedPreset);

  const guidedComplete = guidedAnswers.every((a) => a.trim().length > 0);
  const guidedBackstory = guidedComplete
    ? `I come from ${guidedAnswers[0].trim()}. ${guidedAnswers[1].trim()}. What I left behind: ${guidedAnswers[2].trim()}.`
    : "";

  const openBackstory =
    "I am a traveler. I've heard of Abraham. I'm not sure what I'm looking for. The tent is open. I walk toward it.";

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
      {/* Title */}
      <div style={{ textAlign: "center", marginBottom: "3rem" }}>
        <h1 style={{ fontSize: "2.5rem", fontWeight: 300, letterSpacing: "0.08em", color: C.accent, margin: 0 }}>
          Abraham&apos;s Tent
        </h1>
        <p style={{ fontSize: "0.9rem", color: C.muted, marginTop: "0.75rem", maxWidth: "28rem", lineHeight: 1.6 }}>
          A tent open on all four sides. A fire. A man watching the horizon.
          <br />Who are you, and why have you come?
        </p>
      </div>

      {/* Tab selector */}
      <div style={{ display: "flex", gap: "0.25rem", marginBottom: "2rem", background: C.deep, borderRadius: "8px", padding: "3px" }}>
        {([
          ["preset", "Choose a Role"],
          ["guided", "Build Your Character"],
          ["open", "Enter as Yourself"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: "0.5rem 1.25rem",
              fontSize: "0.8rem",
              fontWeight: 500,
              letterSpacing: "0.04em",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              transition: "all 0.2s",
              background: tab === key ? C.panel : "transparent",
              color: tab === key ? C.accent : C.muted,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div style={{ width: "100%", maxWidth: "52rem" }}>

        {/* ── Preset tab ── */}
        {tab === "preset" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1rem", marginBottom: "1.5rem" }}>
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedPreset(p.id)}
                  style={{
                    textAlign: "left",
                    padding: "1.25rem",
                    background: selectedPreset === p.id ? C.panelHover : C.panel,
                    border: `1px solid ${selectedPreset === p.id ? C.borderActive : C.border}`,
                    borderRadius: "10px",
                    cursor: "pointer",
                    transition: "all 0.2s",
                    color: C.text,
                  }}
                >
                  <div style={{ fontSize: "1rem", fontWeight: 600, color: selectedPreset === p.id ? C.accent : C.text, marginBottom: "0.5rem" }}>
                    {p.title}
                  </div>
                  <div style={{ fontSize: "0.8rem", color: C.muted, lineHeight: 1.5 }}>
                    {p.backstory}
                  </div>
                </button>
              ))}
            </div>
            <div style={{ textAlign: "center" }}>
              <button
                onClick={() => presetEntry && startSession(presetEntry.backstory)}
                disabled={!presetEntry || loading}
                style={{
                  padding: "0.75rem 2.5rem",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  border: "none",
                  borderRadius: "8px",
                  cursor: presetEntry && !loading ? "pointer" : "not-allowed",
                  background: presetEntry ? C.accent : C.border,
                  color: presetEntry ? C.deep : C.muted,
                  opacity: loading ? 0.6 : 1,
                  transition: "all 0.2s",
                }}
              >
                {loading ? "Entering..." : "Select a Role"}
              </button>
            </div>
          </div>
        )}

        {/* ── Guided tab ── */}
        {tab === "guided" && (
          <div style={{ maxWidth: "32rem", margin: "0 auto" }}>
            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "block", fontSize: "0.85rem", color: C.accent, marginBottom: "0.5rem", fontWeight: 500 }}>
                {GUIDED_PROMPTS[guidedStep].label}
              </label>
              <textarea
                value={guidedAnswers[guidedStep]}
                onChange={(e) => {
                  const next = [...guidedAnswers];
                  next[guidedStep] = e.target.value;
                  setGuidedAnswers(next);
                }}
                placeholder={GUIDED_PROMPTS[guidedStep].placeholder}
                rows={3}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  fontSize: "0.85rem",
                  background: C.panel,
                  border: `1px solid ${C.border}`,
                  borderRadius: "8px",
                  color: C.text,
                  resize: "vertical",
                  lineHeight: 1.5,
                  fontFamily: "inherit",
                }}
              />
              {/* Step indicators */}
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", justifyContent: "center" }}>
                {GUIDED_PROMPTS.map((_, i) => (
                  <div
                    key={i}
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: i === guidedStep ? C.accent : i < guidedStep && guidedAnswers[i].trim() ? C.muted : C.border,
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                    onClick={() => setGuidedStep(i)}
                  />
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
              {guidedStep > 0 && (
                <button
                  onClick={() => setGuidedStep(guidedStep - 1)}
                  style={{
                    padding: "0.6rem 1.5rem",
                    fontSize: "0.85rem",
                    border: `1px solid ${C.border}`,
                    borderRadius: "8px",
                    cursor: "pointer",
                    background: "transparent",
                    color: C.muted,
                  }}
                >
                  Back
                </button>
              )}
              {guidedStep < GUIDED_PROMPTS.length - 1 ? (
                <button
                  onClick={() => setGuidedStep(guidedStep + 1)}
                  disabled={!guidedAnswers[guidedStep].trim()}
                  style={{
                    padding: "0.6rem 1.5rem",
                    fontSize: "0.85rem",
                    border: "none",
                    borderRadius: "8px",
                    cursor: guidedAnswers[guidedStep].trim() ? "pointer" : "not-allowed",
                    background: guidedAnswers[guidedStep].trim() ? C.accent : C.border,
                    color: guidedAnswers[guidedStep].trim() ? C.deep : C.muted,
                    fontWeight: 600,
                  }}
                >
                  Next
                </button>
              ) : (
                <button
                  onClick={() => guidedComplete && startSession(guidedBackstory)}
                  disabled={!guidedComplete || loading}
                  style={{
                    padding: "0.6rem 1.5rem",
                    fontSize: "0.85rem",
                    border: "none",
                    borderRadius: "8px",
                    cursor: guidedComplete && !loading ? "pointer" : "not-allowed",
                    background: guidedComplete ? C.accent : C.border,
                    color: guidedComplete ? C.deep : C.muted,
                    fontWeight: 600,
                    opacity: loading ? 0.6 : 1,
                  }}
                >
                  {loading ? "Entering..." : "Begin Journey"}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Open tab ── */}
        {tab === "open" && (
          <div style={{ textAlign: "center", maxWidth: "28rem", margin: "0 auto" }}>
            <p style={{ fontSize: "0.9rem", color: C.muted, lineHeight: 1.7, marginBottom: "2rem" }}>
              You&apos;ve heard of Abraham. You&apos;re not sure what you&apos;re looking for.
              The tent is ahead, open on all four sides. You walk toward it.
            </p>
            <button
              onClick={() => startSession(openBackstory)}
              disabled={loading}
              style={{
                padding: "0.85rem 3rem",
                fontSize: "1rem",
                fontWeight: 600,
                letterSpacing: "0.06em",
                border: `1px solid ${C.borderActive}`,
                borderRadius: "8px",
                cursor: loading ? "not-allowed" : "pointer",
                background: "transparent",
                color: C.accent,
                opacity: loading ? 0.6 : 1,
                transition: "all 0.2s",
              }}
            >
              {loading ? "Entering..." : "Enter the Tent"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

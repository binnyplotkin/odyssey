"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type SessionOverview = {
  sessionId: string;
  scenario: {
    role: string;
    setting: string;
    goal: string;
    interviewType: string;
    industry: string;
    specificityLevel?: "broad" | "balanced" | "high";
  };
  currentPrompt: string;
  activeDifficulty: number;
  remainingSeconds: number;
  turnCount: number;
  progress?: {
    sessionsStarted: number;
    sessionsCompleted: number;
    questionsAttempted: number;
    questionsCorrect: number;
    accuracyRate: number;
    avgRelativeScore: number;
    bestRelativeScore: number;
  };
};

type TurnResponse = {
  latestTurn: {
    score: { overall: number };
    personaReactions: Array<{
      text: string;
      interrupt: boolean;
      expression: "approving" | "neutral" | "skeptical" | "confused" | "critical";
      emotionalImpact: "calming" | "neutral" | "pressuring";
    }>;
  };
  nextPrompt: string;
  shouldEnd: boolean;
  liveCoaching: string[];
  scoreDelta: number;
  relativeToDifficulty: {
    relativeScore: number;
    targetScore: number;
    status: "below-target" | "on-track" | "exceeding";
  };
  activeDifficulty: number;
  remainingSeconds: number;
  turnCount: number;
  correctCount: number;
  accuracyRate: number;
  progress: {
    sessionsStarted: number;
    sessionsCompleted: number;
    questionsAttempted: number;
    questionsCorrect: number;
    accuracyRate: number;
    avgRelativeScore: number;
    bestRelativeScore: number;
  };
};

type FeedbackResponse = {
  feedback: {
    overallScore: number;
    communicationScore: number;
    hireabilityScore: number;
    roleSpecificFeedback: string[];
    missedOpportunities: string[];
    serviceEvaluation?: {
      confidence: number;
      clarity: number;
      professionalism: number;
      customerServiceReadiness: number;
      reliabilityHireability: number;
      strongestMoment: string;
      weakestMoment: string;
      bestAnswer: string;
      tooVagueAnswer: string;
      followUpSuggestion: string;
    };
    strengths: string[];
    weaknesses: string[];
    keyMoments: string[];
    recommendedNextScenario: string;
  };
};

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}`;
}

export function InterviewSimulationConsole({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [session, setSession] = useState<SessionOverview | null>(null);
  const [interviewStarted, setInterviewStarted] = useState(false);
  const [timer, setTimer] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [responseDraft, setResponseDraft] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackResponse["feedback"] | null>(null);
  const [liveCoaching, setLiveCoaching] = useState<string[]>([]);
  const [score, setScore] = useState<number | null>(null);
  const [scoreDelta, setScoreDelta] = useState<number>(0);
  const [correctCount, setCorrectCount] = useState<number>(0);
  const [accuracyRate, setAccuracyRate] = useState<number>(0);
  const [turnCount, setTurnCount] = useState<number>(0);
  const [relativeScore, setRelativeScore] = useState<number | null>(null);
  const [relativeStatus, setRelativeStatus] = useState<"below-target" | "on-track" | "exceeding" | null>(
    null,
  );
  const [relativeTarget, setRelativeTarget] = useState<number | null>(null);
  const [domainProgress, setDomainProgress] = useState<SessionOverview["progress"] | null>(null);
  const [panelReactions, setPanelReactions] = useState<
    Array<{
      text: string;
      interrupt: boolean;
      expression?: "approving" | "neutral" | "skeptical" | "confused" | "critical";
      emotionalImpact?: "calming" | "neutral" | "pressuring";
    }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [difficultyLevel, setDifficultyLevel] = useState<number>(5);
  const [targetInterview, setTargetInterview] = useState("");
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [profileReasoning, setProfileReasoning] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const response = await fetch(`/api/communication/session/${sessionId}`, { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setError(payload.error ?? "Unable to load simulation session.");
        return;
      }
      const payload = (await response.json()) as SessionOverview;
      setSession(payload);
      setPrompt(payload.currentPrompt);
      setTimer(payload.remainingSeconds);
      setDifficultyLevel(payload.activeDifficulty);
      setDomainProgress(payload.progress ?? null);
    })();
  }, [sessionId]);

  useEffect(() => {
    if (!interviewStarted || feedback) {
      return;
    }
    const interval = window.setInterval(() => {
      setTimer((current) => Math.max(0, current - 1));
    }, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, [interviewStarted, feedback]);

  useEffect(() => {
    if (timer !== 0 || !interviewStarted || feedback) {
      return;
    }
    void finalize();
  }, [timer, interviewStarted, feedback]);

  async function finalize() {
    const response = await fetch("/api/communication/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    const payload = (await response.json()) as FeedbackResponse | { error?: string };
    if (!response.ok) {
      setError((payload as { error?: string }).error ?? "Unable to finalize simulation.");
      return;
    }
    setFeedback((payload as FeedbackResponse).feedback);
  }

  async function submitTurn() {
    if (!responseDraft.trim() || isSubmitting || !interviewStarted || feedback) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/communication/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          transcript: responseDraft,
          signal: {
            startDetected: true,
            endDetected: true,
            durationSeconds: Math.max(12, Math.ceil(responseDraft.trim().split(/\s+/).length / 2.4)),
            pauseCount: (responseDraft.match(/\.{3}|,|;/g) ?? []).length,
          },
        }),
      });

      const payload = (await response.json()) as TurnResponse | { error?: string };
      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "Turn request failed.");
        return;
      }

      const next = payload as TurnResponse;
      setPrompt(next.nextPrompt);
      setResponseDraft("");
      setTimer(next.remainingSeconds);
      setDifficultyLevel(next.activeDifficulty);
      setScore(next.latestTurn.score.overall);
      setScoreDelta(next.scoreDelta);
      setRelativeScore(next.relativeToDifficulty.relativeScore);
      setRelativeStatus(next.relativeToDifficulty.status);
      setRelativeTarget(next.relativeToDifficulty.targetScore);
      setCorrectCount(next.correctCount);
      setAccuracyRate(next.accuracyRate);
      setTurnCount(next.turnCount);
      setDomainProgress(next.progress);
      setPanelReactions(next.latestTurn.personaReactions);
      setLiveCoaching(next.liveCoaching);

      if (next.shouldEnd) {
        await finalize();
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function updateDifficulty(next: number) {
    setDifficultyLevel(next);
    const response = await fetch(`/api/communication/session/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ difficultyLevel: next }),
    });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setError(payload.error ?? "Unable to update difficulty.");
    }
  }

  const headerSubtitle = useMemo(() => {
    if (!session) {
      return "Loading simulation...";
    }
    const specificity = session.scenario.specificityLevel;
    return `${session.scenario.role} • ${session.scenario.industry} • difficulty ${session.activeDifficulty}/10${
      specificity ? ` • specificity ${specificity}` : ""
    }`;
  }, [session]);

  const interviewTitle = useMemo(() => {
    if (!session) {
      return "Interview Simulation";
    }
    return `${session.scenario.role} • L${session.activeDifficulty}/10`;
  }, [session]);

  const openingLines = useMemo(() => {
    if (!session) {
      return [];
    }

    const isJaneStreetContext =
      /jane\s*street|janestreet/i.test(session.scenario.role) ||
      /jane\s*street|janestreet/i.test(session.scenario.industry);

    if (isJaneStreetContext) {
      return [
        "Hi, nice to meet you. Thanks for joining us today.",
        "This simulation follows a Jane Street-style process: recruiter-style opening, technical screen, then onsite-style practical and reasoning rounds.",
        "We will move quickly, challenge assumptions, and evaluate collaboration as much as correctness. Think out loud and ask clarifying questions.",
      ];
    }

    const isServiceInterview =
      session.scenario.interviewType === "job-interview" &&
      (/cashier|crew|barista|retail|customer service|front counter|restaurant/i.test(
        session.scenario.role,
      ) ||
        /service|retail|restaurant|hospitality/i.test(session.scenario.industry));

    if (isServiceInterview) {
      return [
        "Scene starts in a busy store with light background noise.",
        "A crew member greets you first, then the manager joins and starts the interview in a casual tone.",
        "Keep answers clear and practical. They are checking reliability, attitude, schedule flexibility, and customer service.",
      ];
    }

    return [
      "Hi, nice to meet you. Thanks for being here today.",
      "We will begin with introductions, then move into scenario-based questions.",
      "Please answer clearly and concisely, and feel free to think out loud when needed.",
    ];
  }, [session]);

  const isGenericInterviewDefault = useMemo(() => {
    if (!session) {
      return false;
    }
    return (
      session.scenario.interviewType === "job-interview" &&
      /general interview candidate/i.test(session.scenario.role)
    );
  }, [session]);

  async function beginInterview() {
    if (targetInterview.trim()) {
      await regenerateInterviewFromTarget();
      return;
    }

    setInterviewStarted(true);
    setPanelReactions(
      openingLines.map((line) => ({
        text: line,
        interrupt: false,
      })),
    );
  }

  async function regenerateInterviewFromTarget() {
    const target = targetInterview.trim();
    if (!target || isRegenerating) {
      return;
    }

    setIsRegenerating(true);
    setError(null);
    try {
      const profileResponse = await fetch("/api/communication/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: target }),
      });
      const profilePayload = (await profileResponse.json()) as {
        profile?: {
          jobType: string;
          interviewType:
            | "job-interview"
            | "technical-interview"
            | "case-interview"
            | "startup-pitch"
            | "panel-presentation"
            | "press-interview"
            | "high-stakes-qa";
          industry: string;
          difficultyLevel: number;
          interviewerCount: number;
          tone: "supportive" | "balanced" | "aggressive";
          timeLimitMinutes: number;
          specificityLevel?: "broad" | "balanced" | "high";
          constraints?: {
            characterRoles?: string[];
            emotionalDynamics?: string;
            scenarioStructure?: string;
            knowledgeDomain?: string;
            toneStyle?: string;
            environmentalDetails?: string;
            pressurePattern?: string;
          };
          reasoning: string;
          webEnhanced: boolean;
        };
        error?: string;
      };
      if (!profileResponse.ok || !profilePayload.profile) {
        throw new Error(profilePayload.error ?? "Failed to build interview profile.");
      }
      setProfileReasoning(
        `${profilePayload.profile.webEnhanced ? "Web-enhanced" : "Heuristic"} profile: ${profilePayload.profile.reasoning}`,
      );

      const response = await fetch("/api/communication/scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profilePayload.profile),
      });
      const data = (await response.json()) as { sessionId?: string; error?: string };
      if (!response.ok || !data.sessionId) {
        throw new Error(data.error ?? "Failed to regenerate interview.");
      }

      router.push(`/simulation/${data.sessionId}`);
      router.refresh();
    } catch (regenError) {
      setError(regenError instanceof Error ? regenError.message : "Failed to regenerate interview.");
    } finally {
      setIsRegenerating(false);
    }
  }

  const isInterviewMode = useMemo(() => {
    const type = session?.scenario.interviewType ?? "";
    return [
      "job-interview",
      "technical-interview",
      "case-interview",
      "startup-pitch",
      "panel-presentation",
      "press-interview",
      "high-stakes-qa",
    ].includes(type);
  }, [session]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-6">
      <section className="panel rounded-[2rem] p-6 md:p-8">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
          Interview Simulation
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-stone-900 md:text-5xl">
          {interviewTitle}
        </h1>
        <p className="mt-3 text-sm leading-7 text-stone-700">{headerSubtitle}</p>
      </section>

      {error ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</section>
      ) : null}

      {!interviewStarted && !feedback ? (
        <section className="panel rounded-[2rem] p-6 md:p-8">
          <p className="text-sm leading-7 text-stone-700">
            {session?.scenario.goal ?? "Preparing simulation context..."}
          </p>
          <p className="mt-2 text-sm leading-7 text-stone-700">
            Timer: <span className="font-semibold text-stone-900">{formatTime(timer)}</span>
          </p>
          <div className="mt-4 space-y-1 text-sm text-stone-700">
            {openingLines.map((line) => (
              <p key={line}>• {line}</p>
            ))}
          </div>
          {isGenericInterviewDefault ? (
            <p className="mt-3 rounded-xl border border-[var(--border)] bg-white/70 px-3 py-2 text-xs leading-6 text-stone-700">
              You selected a general interview simulation, so this run defaults to average difficulty (L5).
              If you want a specific interview style (for example Jane Street), specify it in the builder prompt before launch.
            </p>
          ) : null}
          <div className="mt-4 rounded-xl border border-[var(--border)] bg-white/70 p-3">
            <p className="text-xs text-stone-700">
              Want a more specific interview? Set it here and regenerate before you begin.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={targetInterview}
                onChange={(event) => setTargetInterview(event.target.value)}
                placeholder="e.g. Jane Street quant interview, McKinsey case"
                className="min-w-[260px] flex-1 rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => void regenerateInterviewFromTarget()}
                disabled={!targetInterview.trim() || isRegenerating}
                className="rounded-full border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium text-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isRegenerating ? "Regenerating..." : "Regenerate Interview"}
              </button>
            </div>
            {profileReasoning ? (
              <p className="mt-2 text-[11px] text-stone-600">{profileReasoning}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void beginInterview()}
            className="mt-5 rounded-full bg-[var(--accent-strong)] px-6 py-3 text-sm font-medium text-amber-50 transition hover:bg-[var(--accent)]"
          >
            {targetInterview.trim() ? "Generate & Begin Interview" : "Begin Interview"}
          </button>
        </section>
      ) : null}

      {interviewStarted && !feedback ? (
        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <article className="panel rounded-[2rem] p-6 md:p-8">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
              Active Prompt
            </p>
            <p className="mt-3 text-base leading-7 text-stone-900">{prompt}</p>

            <p className="mt-5 font-mono text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
              Your Response
            </p>
            <textarea
              value={responseDraft}
              onChange={(event) => setResponseDraft(event.target.value)}
              placeholder="Speak your answer, or type your transcript here..."
              className="mt-3 min-h-40 w-full rounded-[1rem] border border-[var(--border)] bg-white/80 px-4 py-4 text-sm leading-7 outline-none"
            />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={submitTurn}
                disabled={isSubmitting || !responseDraft.trim()}
                className="rounded-full bg-[var(--accent-strong)] px-5 py-2.5 text-sm font-medium text-amber-50 transition hover:bg-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Evaluating..." : "Submit Response"}
              </button>
              <p className="text-sm text-stone-700">
                Time Remaining: <span className="font-semibold text-stone-900">{formatTime(timer)}</span>
              </p>
            </div>
          </article>

          <aside className="panel rounded-[2rem] p-6 md:p-8">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
              Live Progress
            </p>
            <div className="mt-3 space-y-2 text-sm text-stone-700">
              <p>Latest score: <span className="font-semibold text-stone-900">{score ?? "—"}</span></p>
              <p>
                Score change:{" "}
                <span
                  className={`font-semibold ${
                    scoreDelta > 0
                      ? "text-emerald-700"
                      : scoreDelta < 0
                        ? "text-red-700"
                        : "text-stone-900"
                  }`}
                >
                  {score === null ? "—" : `${scoreDelta > 0 ? "+" : ""}${scoreDelta}`}
                </span>
              </p>
              <p>
                Questions handled:{" "}
                <span className="font-semibold text-stone-900">
                  {turnCount === 0 ? "—" : `${correctCount}/${turnCount}`}
                </span>
              </p>
              <p>
                Accuracy:{" "}
                <span className="font-semibold text-stone-900">
                  {turnCount === 0 ? "—" : `${accuracyRate}%`}
                </span>
              </p>
              <p>
                Difficulty-relative:{" "}
                <span className="font-semibold text-stone-900">
                  {relativeScore === null ? "—" : `${relativeScore}/100`}
                </span>
              </p>
              <p>
                Relative status:{" "}
                <span
                  className={`font-semibold ${
                    relativeStatus === "exceeding"
                      ? "text-emerald-700"
                      : relativeStatus === "below-target"
                        ? "text-red-700"
                        : "text-amber-700"
                  }`}
                >
                  {relativeStatus ?? "—"}
                </span>
                {relativeTarget !== null ? ` (target ${relativeTarget})` : ""}
              </p>
            </div>

            <p className="mt-5 font-mono text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
              Panel Reactions
            </p>
            <div className="mt-2 space-y-2 text-sm text-stone-700">
              {panelReactions.length === 0 ? (
                <p>No reactions yet.</p>
              ) : (
                panelReactions.map((reaction, index) => (
                  <p key={`${index}-${reaction.text}`}>
                    {reaction.interrupt ? "Interrupt: " : ""}
                    {reaction.text}
                    {reaction.expression ? (
                      <span className="ml-1 text-[11px] uppercase tracking-[0.12em] text-stone-500">
                        [{reaction.expression} • {reaction.emotionalImpact ?? "neutral"}]
                      </span>
                    ) : null}
                  </p>
                ))
              )}
            </div>

            <p className="mt-5 font-mono text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
              Live Coaching
            </p>
            <div className="mt-2 space-y-2 text-sm text-stone-700">
              {liveCoaching.length === 0 ? <p>Submit a response to receive guidance.</p> : null}
              {liveCoaching.map((item) => (
                <p key={item}>• {item}</p>
              ))}
            </div>

            {isInterviewMode ? (
              <div className="mt-6 rounded-2xl border border-[var(--border)] bg-white/65 p-4">
                <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                  Interview Difficulty
                </p>
                <div className="mt-3 flex items-center gap-4">
                  <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-[var(--border)] bg-white">
                    <span className="text-lg font-semibold text-stone-900">{difficultyLevel}</span>
                    <span className="absolute -right-2 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-[var(--accent-strong)]" />
                  </div>
                  <div className="flex-1">
                    <input
                      type="range"
                      min={1}
                      max={10}
                      step={1}
                      value={difficultyLevel}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        void updateDifficulty(next);
                      }}
                      className="w-full accent-[var(--accent-strong)]"
                    />
                    <div className="mt-1 flex justify-between text-[10px] text-stone-500">
                      <span>L1</span>
                      <span>L3</span>
                      <span>L5</span>
                      <span>L7</span>
                      <span>L10</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {domainProgress ? (
              <div className="mt-4 rounded-2xl border border-[var(--border)] bg-white/65 p-4">
                <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
                  Remembered Progress
                </p>
                <div className="mt-2 space-y-1 text-xs text-stone-700">
                  <p>Sessions: {domainProgress.sessionsCompleted}/{domainProgress.sessionsStarted} completed</p>
                  <p>Total questions: {domainProgress.questionsCorrect}/{domainProgress.questionsAttempted} correct</p>
                  <p>Domain accuracy: {domainProgress.accuracyRate}%</p>
                  <p>Avg difficulty-relative score: {domainProgress.avgRelativeScore}</p>
                  <p>Best difficulty-relative score: {domainProgress.bestRelativeScore}</p>
                </div>
              </div>
            ) : null}
          </aside>
        </section>
      ) : null}

      {feedback ? (
        <section className="panel rounded-[2rem] p-6 md:p-8">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Final Feedback</p>
          <h2 className="mt-3 text-2xl font-semibold text-stone-900">Overall Score: {feedback.overallScore}/100</h2>
          <div className="mt-2 grid gap-2 text-sm text-stone-700 md:grid-cols-2">
            <p>
              Communication score: <span className="font-semibold text-stone-900">{feedback.communicationScore}/100</span>
            </p>
            <p>
              Hireability score: <span className="font-semibold text-stone-900">{feedback.hireabilityScore}/100</span>
            </p>
          </div>
          {feedback.serviceEvaluation ? (
            <div className="mt-4 rounded-2xl border border-[var(--border)] bg-white/70 p-4 text-sm text-stone-700">
              <p className="font-medium text-stone-900">Service Interview Categories</p>
              <div className="mt-2 grid gap-1 md:grid-cols-2">
                <p>Confidence: {feedback.serviceEvaluation.confidence}/100</p>
                <p>Clarity: {feedback.serviceEvaluation.clarity}/100</p>
                <p>Professionalism: {feedback.serviceEvaluation.professionalism}/100</p>
                <p>Customer-service readiness: {feedback.serviceEvaluation.customerServiceReadiness}/100</p>
                <p>Reliability / hireability: {feedback.serviceEvaluation.reliabilityHireability}/100</p>
              </div>
              <div className="mt-3 space-y-1 text-xs">
                <p>Strongest moment: {feedback.serviceEvaluation.strongestMoment}</p>
                <p>Weakest moment: {feedback.serviceEvaluation.weakestMoment}</p>
                <p>Best answer: {feedback.serviceEvaluation.bestAnswer}</p>
                <p>Too vague: {feedback.serviceEvaluation.tooVagueAnswer}</p>
                <p>Follow-up: {feedback.serviceEvaluation.followUpSuggestion}</p>
              </div>
            </div>
          ) : null}
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <p className="font-medium text-stone-900">Strengths</p>
              {feedback.strengths.map((item) => (
                <p key={item} className="mt-1 text-sm text-stone-700">• {item}</p>
              ))}
            </div>
            <div>
              <p className="font-medium text-stone-900">Weaknesses</p>
              {feedback.weaknesses.map((item) => (
                <p key={item} className="mt-1 text-sm text-stone-700">• {item}</p>
              ))}
            </div>
            <div>
              <p className="font-medium text-stone-900">Role-Specific Feedback</p>
              {feedback.roleSpecificFeedback.map((item) => (
                <p key={item} className="mt-1 text-sm text-stone-700">• {item}</p>
              ))}
            </div>
            <div>
              <p className="font-medium text-stone-900">Missed Opportunities</p>
              {feedback.missedOpportunities.map((item) => (
                <p key={item} className="mt-1 text-sm text-stone-700">• {item}</p>
              ))}
            </div>
          </div>
          <p className="mt-5 text-sm text-stone-700">
            <span className="font-medium text-stone-900">Recommended next scenario: </span>
            {feedback.recommendedNextScenario}
          </p>
        </section>
      ) : null}
    </main>
  );
}

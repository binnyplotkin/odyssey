"use client";

import { useEffect, useState } from "react";

type VoicesDebugResponse = {
  timestamp: string;
  pricingGuard: {
    enforceNormalPricing: boolean;
    configuredModelId: string | null;
    effectiveModelId: string;
    allowedModelIds: string[];
    isAllowedModel: boolean;
  };
  discovery: {
    hasApiKey: boolean;
    allowProfessionalVoices: boolean;
    cache: {
      hit: boolean;
      expiresAt: string | null;
      ttlSeconds: number;
    };
    counts: {
      raw: number;
      filtered: number;
    };
    voices: Array<{
      voiceId: string;
      name: string;
      category: string;
    }>;
    error: string | null;
  };
};

export function VoicesDebugPanel() {
  const [data, setData] = useState<VoicesDebugResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  async function load() {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/audio/voices", { cache: "no-store" });
      const payload = (await response.json()) as
        | VoicesDebugResponse
        | { error?: string };

      if (!response.ok) {
        setError((payload as { error?: string }).error ?? "Failed to load voices debug.");
        setData(null);
        return;
      }

      setData(payload as VoicesDebugResponse);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load voices debug.",
      );
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-6 lg:px-8">
      <section className="panel rounded-[2rem] p-6 md:p-8">
        <p className="font-mono text-xs uppercase tracking-[0.28em] text-[var(--muted)]">
          Voice Debug
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-stone-900 md:text-5xl">
          ElevenLabs Discovery and Pricing Guard
        </h1>
        <p className="mt-4 max-w-4xl text-sm leading-7 text-stone-700 md:text-base">
          Validate live voice discovery, filtered voice count, and normal-pricing enforcement.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              void load();
            }}
            disabled={isLoading}
            className="rounded-full bg-[var(--accent-strong)] px-6 py-3 text-sm font-medium text-amber-50 transition hover:bg-[var(--accent)] disabled:opacity-60"
          >
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>
          {data?.timestamp ? (
            <span className="font-mono text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
              Updated {new Date(data.timestamp).toLocaleTimeString()}
            </span>
          ) : null}
        </div>

        {error ? (
          <p className="mt-4 text-sm text-[var(--danger)]">{error}</p>
        ) : null}
        {data?.discovery.error ? (
          <p className="mt-4 text-sm text-[var(--danger)]">{data.discovery.error}</p>
        ) : null}
      </section>

      {data ? (
        <section className="grid gap-4 md:grid-cols-2">
          <article className="panel rounded-[1.5rem] p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
              Pricing Guard
            </p>
            <div className="mt-3 space-y-2 text-sm text-stone-700">
              <p>
                <span className="font-medium text-stone-900">Enforced:</span>{" "}
                {data.pricingGuard.enforceNormalPricing ? "yes" : "no"}
              </p>
              <p>
                <span className="font-medium text-stone-900">Configured model:</span>{" "}
                {data.pricingGuard.configuredModelId ?? "(default)"}
              </p>
              <p>
                <span className="font-medium text-stone-900">Effective model:</span>{" "}
                {data.pricingGuard.effectiveModelId}
              </p>
              <p>
                <span className="font-medium text-stone-900">Allowed models:</span>{" "}
                {data.pricingGuard.allowedModelIds.join(", ")}
              </p>
              <p>
                <span className="font-medium text-stone-900">Allowed currently:</span>{" "}
                {data.pricingGuard.isAllowedModel ? "yes" : "no"}
              </p>
            </div>
          </article>

          <article className="panel rounded-[1.5rem] p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
              Discovery
            </p>
            <div className="mt-3 space-y-2 text-sm text-stone-700">
              <p>
                <span className="font-medium text-stone-900">API key present:</span>{" "}
                {data.discovery.hasApiKey ? "yes" : "no"}
              </p>
              <p>
                <span className="font-medium text-stone-900">Allow professional voices:</span>{" "}
                {data.discovery.allowProfessionalVoices ? "yes" : "no"}
              </p>
              <p>
                <span className="font-medium text-stone-900">Cache hit:</span>{" "}
                {data.discovery.cache.hit ? "yes" : "no"}
              </p>
              <p>
                <span className="font-medium text-stone-900">Cache TTL:</span>{" "}
                {data.discovery.cache.ttlSeconds}s
              </p>
              <p>
                <span className="font-medium text-stone-900">Raw voices:</span>{" "}
                {data.discovery.counts.raw}
              </p>
              <p>
                <span className="font-medium text-stone-900">Filtered voices:</span>{" "}
                {data.discovery.counts.filtered}
              </p>
              <p>
                <span className="font-medium text-stone-900">Cache expires:</span>{" "}
                {data.discovery.cache.expiresAt
                  ? new Date(data.discovery.cache.expiresAt).toLocaleTimeString()
                  : "n/a"}
              </p>
            </div>
          </article>
        </section>
      ) : null}

      {data ? (
        <section className="panel rounded-[1.5rem] p-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
            Filtered Voices
          </p>
          <div className="mt-4 overflow-x-auto rounded-[1rem] border border-[var(--border)] bg-white/80">
            <table className="min-w-full text-left text-sm text-stone-700">
              <thead className="border-b border-[var(--border)] bg-white/90 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Voice ID</th>
                  <th className="px-4 py-3">Category</th>
                </tr>
              </thead>
              <tbody>
                {data.discovery.voices.map((voice) => (
                  <tr key={voice.voiceId} className="border-b border-[var(--border)]/50">
                    <td className="px-4 py-3 text-stone-900">{voice.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--muted)]">
                      {voice.voiceId}
                    </td>
                    <td className="px-4 py-3">{voice.category}</td>
                  </tr>
                ))}
                {data.discovery.voices.length === 0 ? (
                  <tr>
                    <td className="px-4 py-5 text-sm text-stone-500" colSpan={3}>
                      No voices discovered with current filter settings.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}

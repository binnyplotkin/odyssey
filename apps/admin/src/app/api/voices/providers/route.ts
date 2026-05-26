import { NextResponse } from "next/server";
import type { VoiceProvider } from "@odyssey/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/voices/providers
 *
 * Reports which TTS providers are **available as a SOURCE for creating new
 * voices** in this deployment. Drives the "+ new voice" Provider Picker
 * modal — each tile reads `configured: true | false` from this response.
 *
 * Not to be confused with `getAudioRuntimeConfig` in @odyssey/engine, which
 * describes the live STT+TTS routing pipeline (and counts ElevenLabs as
 * configured only when both an API key AND a voice id are set). Here we
 * just need to know "can the user create a new voice via this provider's
 * library" — that's purely an API-key check.
 */

export type ProviderAvailability = {
  provider: VoiceProvider;
  configured: boolean;
  /** Env var name a workspace admin needs to set to enable this provider.
   * Surfaced in the picker's "NOT CONFIGURED" tile so the user knows what
   * to do. Pocket TTS has no key — it's our self-hosted default. */
  envKey: string | null;
};

export type ProvidersResponse = {
  providers: ProviderAvailability[];
  /** Count of `configured: true` rows — the client uses this to decide
   * whether to bypass the picker and go straight to a provider form. */
  configuredCount: number;
};

export async function GET() {
  // Pocket TTS is always "ready" — it's our default self-hosted backend.
  // The actual audio-rt service may or may not be reachable, but for the
  // purposes of the picker the row is always present and clickable.
  const pocket: ProviderAvailability = {
    provider: "pocket_tts",
    configured: true,
    envKey: null,
  };
  const elevenlabs: ProviderAvailability = {
    provider: "elevenlabs",
    configured: Boolean(process.env.ELEVENLABS_API_KEY),
    envKey: "ELEVENLABS_API_KEY",
  };
  const openai: ProviderAvailability = {
    provider: "openai",
    configured: Boolean(process.env.OPENAI_API_KEY),
    envKey: "OPENAI_API_KEY",
  };
  const cartesia: ProviderAvailability = {
    provider: "cartesia",
    configured: Boolean(process.env.CARTESIA_API_KEY),
    envKey: "CARTESIA_API_KEY",
  };

  const providers = [pocket, elevenlabs, openai, cartesia];
  const configuredCount = providers.filter((p) => p.configured).length;

  return NextResponse.json({ providers, configuredCount });
}

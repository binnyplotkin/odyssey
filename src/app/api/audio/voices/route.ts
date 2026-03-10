import { NextResponse } from "next/server";
import { getElevenLabsPricingGuardInfo } from "@/lib/simulation/audio";
import { getVoiceDiscoveryDebugInfo } from "@/lib/simulation/voice-mapping";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [pricingGuard, discovery] = await Promise.all([
      Promise.resolve(getElevenLabsPricingGuardInfo()),
      getVoiceDiscoveryDebugInfo(),
    ]);

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      pricingGuard,
      discovery,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load voices debug data.",
      },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { getAudioRuntimeConfig } from "@odyssey/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = getAudioRuntimeConfig();
    return NextResponse.json({
      timestamp: new Date().toISOString(),
      config,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load audio config.",
      },
      { status: 500 },
    );
  }
}

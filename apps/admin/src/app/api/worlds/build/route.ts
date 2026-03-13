import { NextRequest, NextResponse } from "next/server";
import { buildWorldFromPrompt } from "@/lib/service";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await buildWorldFromPrompt(body);

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build world.";
    const status =
      message.includes("requires OPENAI_API_KEY") ||
      message.includes("requires DATABASE_URL") ||
      message.includes("requires the worlds table")
        ? 503
        : message.includes("required") ||
            message.includes("Expected") ||
            message.includes("Invalid")
          ? 400
          : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

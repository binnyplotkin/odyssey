import { NextRequest, NextResponse } from "next/server";
import { traceTurnPipeline } from "@/lib/service";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await traceTurnPipeline(body);

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to build engine trace.";
    const status = message.includes("required") || message.includes("Unknown") ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

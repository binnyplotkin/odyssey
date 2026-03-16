import { NextResponse } from "next/server";
import { replaySession } from "@/lib/service";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const result = await replaySession(sessionId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to replay session." },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { processTurn } from "@/lib/simulation/service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    const body = await request.json();
    const result = await processTurn(sessionId, body);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process turn." },
      { status: 500 },
    );
  }
}

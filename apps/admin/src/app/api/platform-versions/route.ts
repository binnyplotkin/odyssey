import { NextRequest, NextResponse } from "next/server";
import { getPlatformVersionStore } from "@odyssey/db";

export const dynamic = "force-dynamic";

/* GET /api/platform-versions — list all platform versions */
export async function GET() {
  try {
    const versions = await getPlatformVersionStore().list();
    return NextResponse.json({ versions });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list platform versions." },
      { status: 500 },
    );
  }
}

/* POST /api/platform-versions — create a platform version */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    if (!body.version || typeof body.version !== "string") {
      return NextResponse.json({ error: "version is required." }, { status: 400 });
    }
    if (!body.title || typeof body.title !== "string") {
      return NextResponse.json({ error: "title is required." }, { status: 400 });
    }

    const version = await getPlatformVersionStore().create({
      version: body.version,
      title: body.title,
      summary: typeof body.summary === "string" ? body.summary : undefined,
      status: typeof body.status === "string" ? body.status : undefined,
    });

    return NextResponse.json({ version }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create platform version." },
      { status: 500 },
    );
  }
}

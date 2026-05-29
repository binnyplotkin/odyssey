import { NextRequest, NextResponse } from "next/server";
import { getSceneStore } from "@odyssey/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const scenes = await getSceneStore().listScenes();
  return NextResponse.json({ scenes });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      title?: string;
      prompt?: string;
      userId?: string | null;
    };

    if (!body.title || typeof body.title !== "string" || body.title.trim().length === 0) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const scene = await getSceneStore().createScene({
      userId: body.userId ?? null,
      title: body.title.trim(),
      prompt: body.prompt ?? "",
    });

    return NextResponse.json({ scene }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create scene." },
      { status: 500 },
    );
  }
}

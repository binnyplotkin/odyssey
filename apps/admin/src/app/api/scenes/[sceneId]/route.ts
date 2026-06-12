import { NextRequest, NextResponse } from "next/server";
import { getSceneGraphStore, getSceneStore } from "@odyssey/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sceneId: string }> },
) {
  try {
    const { sceneId } = await params;
    const scene = await getSceneStore().getSceneById(sceneId);
    if (!scene) {
      return NextResponse.json({ error: "Scene not found." }, { status: 404 });
    }
    const graph = await getSceneGraphStore().getGraph(sceneId);
    return NextResponse.json({ scene, graph });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load scene." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sceneId: string }> },
) {
  try {
    const { sceneId } = await params;
    const body = (await request.json()) as {
      title?: string;
      prompt?: string;
      status?: "draft" | "active" | "archived";
      definition?: Record<string, unknown>;
    };

    const updated = await getSceneStore().updateScene(sceneId, {
      title: body.title,
      prompt: body.prompt,
      status: body.status,
      definition: body.definition,
    });

    if (!updated) {
      return NextResponse.json({ error: "Scene not found." }, { status: 404 });
    }

    return NextResponse.json({ scene: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update scene.";
    const status = /Invalid|Expected|required/.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ sceneId: string }> },
) {
  try {
    const { sceneId } = await params;
    const archived = await getSceneStore().archiveScene(sceneId);
    if (!archived) {
      return NextResponse.json({ error: "Scene not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to archive scene." },
      { status: 500 },
    );
  }
}

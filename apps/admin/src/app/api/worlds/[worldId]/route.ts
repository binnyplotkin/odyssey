import { NextRequest, NextResponse } from "next/server";
import {
  getWorldDetailById,
  updateWorldDefinition,
} from "@/lib/service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ worldId: string }> },
) {
  try {
    const { worldId } = await params;
    const detail = await getWorldDetailById(worldId);

    if (!detail) {
      return NextResponse.json({ error: "World not found." }, { status: 404 });
    }

    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load world." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ worldId: string }> },
) {
  try {
    const { worldId } = await params;
    const existing = await getWorldDetailById(worldId);

    if (!existing) {
      return NextResponse.json({ error: "World not found." }, { status: 404 });
    }

    if (!existing.editable) {
      return NextResponse.json(
        { error: "Static worlds are read-only." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as { definition?: unknown };

    if (!body.definition) {
      return NextResponse.json(
        { error: "definition is required." },
        { status: 400 },
      );
    }

    const updated = await updateWorldDefinition(worldId, body.definition);

    if (!updated) {
      return NextResponse.json({ error: "World not found." }, { status: 404 });
    }

    return NextResponse.json({
      source: "dynamic",
      editable: true,
      world: updated.definition,
      record: updated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update world.";
    const status = message.includes("Invalid") || message.includes("Expected") ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getVersionStore } from "@odyssey/db";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ versionId: string }> };

/* GET /api/versions/:id */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { versionId } = await params;
    const version = await getVersionStore().getById(versionId);

    if (!version) {
      return NextResponse.json({ error: "Version not found." }, { status: 404 });
    }

    return NextResponse.json({ version });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load version." },
      { status: 500 },
    );
  }
}

/* PATCH /api/versions/:id */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { versionId } = await params;
    const body = (await request.json()) as Record<string, unknown>;

    const version = await getVersionStore().update(versionId, {
      ...(typeof body.tag === "string" && { tag: body.tag }),
      ...(typeof body.title === "string" && { title: body.title }),
      ...(typeof body.description === "string" && { description: body.description }),
      ...(body.description === null && { description: null }),
      ...(typeof body.color === "string" && { color: body.color }),
      ...(typeof body.status === "string" && { status: body.status }),
      ...(typeof body.startDate === "string" && { startDate: body.startDate }),
      ...(body.startDate === null && { startDate: null }),
      ...(typeof body.endDate === "string" && { endDate: body.endDate }),
      ...(body.endDate === null && { endDate: null }),
      ...(typeof body.sortOrder === "number" && { sortOrder: body.sortOrder }),
    });

    if (!version) {
      return NextResponse.json({ error: "Version not found." }, { status: 404 });
    }

    return NextResponse.json({ version });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update version." },
      { status: 500 },
    );
  }
}

/* DELETE /api/versions/:id */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { versionId } = await params;
    const removed = await getVersionStore().remove(versionId);

    if (!removed) {
      return NextResponse.json({ error: "Version not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete version." },
      { status: 500 },
    );
  }
}

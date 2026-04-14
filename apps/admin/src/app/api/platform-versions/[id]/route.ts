import { NextRequest, NextResponse } from "next/server";
import { getPlatformVersionStore } from "@odyssey/db";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

/* GET /api/platform-versions/:id */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const version = await getPlatformVersionStore().getById(id);
    if (!version) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ version });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load platform version." },
      { status: 500 },
    );
  }
}

/* PATCH /api/platform-versions/:id */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;

    const version = await getPlatformVersionStore().update(id, {
      ...(typeof body.version === "string" && { version: body.version }),
      ...(typeof body.title === "string" && { title: body.title }),
      ...(typeof body.summary === "string" && { summary: body.summary }),
      ...(body.summary === null && { summary: null }),
      ...(typeof body.status === "string" && { status: body.status }),
      ...(typeof body.releasedAt === "string" && { releasedAt: body.releasedAt }),
      ...(body.releasedAt === null && { releasedAt: null }),
    });

    if (!version) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ version });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update platform version." },
      { status: 500 },
    );
  }
}

/* DELETE /api/platform-versions/:id */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const removed = await getPlatformVersionStore().remove(id);
    if (!removed) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete platform version." },
      { status: 500 },
    );
  }
}

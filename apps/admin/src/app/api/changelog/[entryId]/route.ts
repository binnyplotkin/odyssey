import { NextRequest, NextResponse } from "next/server";
import { getChangelogStore } from "@odyssey/db";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ entryId: string }> };

/* GET /api/changelog/:id */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { entryId } = await params;
    const entry = await getChangelogStore().getById(entryId);
    if (!entry) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ entry });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load entry." },
      { status: 500 },
    );
  }
}

/* PATCH /api/changelog/:id */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { entryId } = await params;
    const body = (await request.json()) as Record<string, unknown>;

    const entry = await getChangelogStore().update(entryId, {
      ...(typeof body.title === "string" && { title: body.title }),
      ...(typeof body.body === "string" && { body: body.body }),
      ...(body.body === null && { body: null }),
      ...(typeof body.category === "string" && { category: body.category }),
      ...(typeof body.versionId === "string" && { versionId: body.versionId }),
      ...(body.versionId === null && { versionId: null }),
    });

    if (!entry) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ entry });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update entry." },
      { status: 500 },
    );
  }
}

/* DELETE /api/changelog/:id */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { entryId } = await params;
    const removed = await getChangelogStore().remove(entryId);
    if (!removed) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete entry." },
      { status: 500 },
    );
  }
}

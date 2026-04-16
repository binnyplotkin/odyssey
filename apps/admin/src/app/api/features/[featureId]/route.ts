import { NextRequest, NextResponse } from "next/server";
import { getFeatureStore } from "@odyssey/db";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ featureId: string }> };

/* GET /api/features/:id */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { featureId } = await params;
    const feature = await getFeatureStore().getById(featureId);

    if (!feature) {
      return NextResponse.json({ error: "Feature not found." }, { status: 404 });
    }

    return NextResponse.json({ feature });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load feature." },
      { status: 500 },
    );
  }
}

/* PATCH /api/features/:id */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { featureId } = await params;
    const body = (await request.json()) as Record<string, unknown>;

    const feature = await getFeatureStore().update(featureId, {
      ...(typeof body.versionId === "string" && { versionId: body.versionId }),
      ...(typeof body.title === "string" && { title: body.title }),
      ...(typeof body.description === "string" && { description: body.description }),
      ...(body.description === null && { description: null }),
      ...(typeof body.color === "string" && { color: body.color }),
      ...(body.color === null && { color: null }),
      ...(typeof body.status === "string" && { status: body.status }),
      ...(typeof body.assignee === "string" && { assignee: body.assignee }),
      ...(body.assignee === null && { assignee: null }),
      ...(typeof body.startDate === "string" && { startDate: body.startDate }),
      ...(body.startDate === null && { startDate: null }),
      ...(typeof body.endDate === "string" && { endDate: body.endDate }),
      ...(body.endDate === null && { endDate: null }),
      ...(typeof body.sortOrder === "number" && { sortOrder: body.sortOrder }),
    });

    if (!feature) {
      return NextResponse.json({ error: "Feature not found." }, { status: 404 });
    }

    return NextResponse.json({ feature });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update feature." },
      { status: 500 },
    );
  }
}

/* DELETE /api/features/:id */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { featureId } = await params;
    const removed = await getFeatureStore().remove(featureId);

    if (!removed) {
      return NextResponse.json({ error: "Feature not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete feature." },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getFeatureStore } from "@odyssey/db";

export const dynamic = "force-dynamic";

/* GET /api/features?versionId=xxx */
export async function GET(request: NextRequest) {
  try {
    const versionId = request.nextUrl.searchParams.get("versionId") ?? undefined;
    const features = await getFeatureStore().list(versionId);
    return NextResponse.json({ features });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load features." },
      { status: 500 },
    );
  }
}

/* POST /api/features */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    if (typeof body.versionId !== "string" || typeof body.title !== "string" || typeof body.status !== "string") {
      return NextResponse.json(
        { error: "versionId, title, and status are required." },
        { status: 400 },
      );
    }

    const feature = await getFeatureStore().create({
      versionId: body.versionId,
      title: body.title,
      status: body.status,
      ...(typeof body.description === "string" && { description: body.description }),
      ...(typeof body.color === "string" && { color: body.color }),
      ...(typeof body.startDate === "string" && { startDate: body.startDate }),
      ...(typeof body.endDate === "string" && { endDate: body.endDate }),
      ...(typeof body.sortOrder === "number" && { sortOrder: body.sortOrder }),
    });

    return NextResponse.json({ feature }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create feature." },
      { status: 500 },
    );
  }
}

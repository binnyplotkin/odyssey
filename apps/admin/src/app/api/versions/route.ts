import { NextRequest, NextResponse } from "next/server";
import { getVersionStore } from "@odyssey/db";

export const dynamic = "force-dynamic";

/* GET /api/versions */
export async function GET() {
  try {
    const versions = await getVersionStore().list();
    return NextResponse.json({ versions });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load versions." },
      { status: 500 },
    );
  }
}

/* POST /api/versions */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    if (typeof body.tag !== "string" || typeof body.title !== "string" || typeof body.color !== "string" || typeof body.status !== "string") {
      return NextResponse.json(
        { error: "tag, title, color, and status are required." },
        { status: 400 },
      );
    }

    const version = await getVersionStore().create({
      tag: body.tag,
      title: body.title,
      color: body.color,
      status: body.status,
      ...(typeof body.description === "string" && { description: body.description }),
      ...(typeof body.startDate === "string" && { startDate: body.startDate }),
      ...(typeof body.endDate === "string" && { endDate: body.endDate }),
      ...(typeof body.sortOrder === "number" && { sortOrder: body.sortOrder }),
    });

    return NextResponse.json({ version }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create version." },
      { status: 500 },
    );
  }
}

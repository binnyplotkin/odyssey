import { NextRequest, NextResponse } from "next/server";
import { getChangelogStore } from "@odyssey/db";

export const dynamic = "force-dynamic";

/* GET /api/changelog — list entries, optionally filter by ?versionId= */
export async function GET(request: NextRequest) {
  try {
    const versionId = request.nextUrl.searchParams.get("versionId") ?? undefined;
    const entries = await getChangelogStore().list(versionId);
    return NextResponse.json({ entries });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list changelog." },
      { status: 500 },
    );
  }
}

/* POST /api/changelog — create an entry */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    if (!body.title || typeof body.title !== "string") {
      return NextResponse.json({ error: "title is required." }, { status: 400 });
    }
    if (!body.category || typeof body.category !== "string") {
      return NextResponse.json({ error: "category is required." }, { status: 400 });
    }

    const entry = await getChangelogStore().create({
      title: body.title,
      body: typeof body.body === "string" ? body.body : undefined,
      category: body.category,
      versionId: typeof body.versionId === "string" ? body.versionId : undefined,
      commitSha: typeof body.commitSha === "string" ? body.commitSha : undefined,
      prNumber: typeof body.prNumber === "number" ? body.prNumber : undefined,
      prTitle: typeof body.prTitle === "string" ? body.prTitle : undefined,
      branch: typeof body.branch === "string" ? body.branch : undefined,
      author: typeof body.author === "string" ? body.author : undefined,
      diffSummary: typeof body.diffSummary === "string" ? body.diffSummary : undefined,
    });

    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create changelog entry." },
      { status: 500 },
    );
  }
}

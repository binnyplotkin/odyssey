import { NextRequest, NextResponse } from "next/server";
import { getWikisStore, type UpdateWikiInput } from "@odyssey/db";
import { auth } from "@/lib/auth";

const MAX_PROMPT_LENGTH = 32_000;
const MAX_NAME_LENGTH = 120;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing wiki id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    prompt?: string;
    name?: string | null;
  };

  const patch: UpdateWikiInput = {};

  if (body.prompt !== undefined) {
    if (typeof body.prompt !== "string") {
      return NextResponse.json(
        { error: "`prompt` must be a string" },
        { status: 400 },
      );
    }
    if (body.prompt.length > MAX_PROMPT_LENGTH) {
      return NextResponse.json(
        { error: `Prompt too long (max ${MAX_PROMPT_LENGTH} chars)` },
        { status: 400 },
      );
    }
    const trimmed = body.prompt.trim();
    patch.ingestionPrompt = trimmed.length === 0 ? null : body.prompt;
  }

  if (body.name !== undefined) {
    if (body.name !== null && typeof body.name !== "string") {
      return NextResponse.json(
        { error: "`name` must be a string or null" },
        { status: 400 },
      );
    }
    const next =
      body.name === null ? null : body.name.trim().slice(0, MAX_NAME_LENGTH);
    patch.ingestionPromptName = next && next.length > 0 ? next : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "Provide at least one of `prompt` or `name`" },
      { status: 400 },
    );
  }

  try {
    const wiki = await getWikisStore().updateWiki(id, patch);
    if (!wiki) {
      return NextResponse.json({ error: "Wiki not found" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      prompt: wiki.ingestionPrompt ?? "",
      name: wiki.ingestionPromptName ?? null,
    });
  } catch (err) {
    console.error("Failed to save wiki prompt", err);
    const message =
      err instanceof Error ? err.message : "Failed to save prompt";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

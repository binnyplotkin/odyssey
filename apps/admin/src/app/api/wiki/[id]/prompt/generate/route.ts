import { NextRequest, NextResponse } from "next/server";
import { getWikisStore } from "@odyssey/db";
import {
  DEFAULT_MODEL,
  generateIngestionPrompt,
  isKnownModel,
  loadWikiContext,
} from "@odyssey/wiki-ingest";
import { auth } from "@/lib/auth";

const MAX_BRIEF_LENGTH = 8_000;

/**
 * Draft an ingestion prompt from the wiki's structured context (eras, bound
 * characters) plus the character brief — the world owner's plain-language
 * explanation of who the character is. Returns the draft only — nothing is
 * saved. The caller reviews and saves via PATCH /api/wiki/[id]/prompt,
 * keeping the human-approval step that makes the prompt authored/axiomatic.
 */
export async function POST(
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
    characterBrief?: string;
    model?: string;
  };

  if (body.characterBrief != null && typeof body.characterBrief !== "string") {
    return NextResponse.json(
      { error: "`characterBrief` must be a string" },
      { status: 400 },
    );
  }
  if (body.characterBrief && body.characterBrief.length > MAX_BRIEF_LENGTH) {
    return NextResponse.json(
      { error: `Character brief too long (max ${MAX_BRIEF_LENGTH} chars)` },
      { status: 400 },
    );
  }
  if (body.model && !isKnownModel(body.model)) {
    return NextResponse.json(
      { error: `unknown model "${body.model}"` },
      { status: 400 },
    );
  }

  const wiki = await getWikisStore().getWikiById(id);
  if (!wiki) {
    return NextResponse.json({ error: "Wiki not found" }, { status: 404 });
  }

  try {
    const wikiContext = await loadWikiContext(wiki);
    const result = await generateIngestionPrompt({
      model: body.model && isKnownModel(body.model) ? body.model : DEFAULT_MODEL,
      wikiContext,
      characterBrief: body.characterBrief ?? null,
    });

    return NextResponse.json({
      ok: true,
      prompt: result.prompt,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.tokens,
    });
  } catch (err) {
    console.error("Failed to generate ingestion prompt", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate prompt";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

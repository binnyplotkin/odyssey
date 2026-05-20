import { NextRequest, NextResponse } from "next/server";
import { call, DEFAULT_MODEL } from "@odyssey/wiki-ingest";
import { auth } from "@/lib/auth";

const MAX_PROMPT_LENGTH = 32_000;
const MAX_SAMPLE_LENGTH = 16_000;
const MAX_OUTPUT_TOKENS = 2_000;

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
    prompt?: string;
    sample?: string;
  };

  if (typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
    return NextResponse.json(
      { error: "Body must include a non-empty `prompt`" },
      { status: 400 },
    );
  }
  if (typeof body.sample !== "string" || body.sample.trim().length === 0) {
    return NextResponse.json(
      { error: "Body must include a non-empty `sample`" },
      { status: 400 },
    );
  }
  if (body.prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { error: `Prompt too long (max ${MAX_PROMPT_LENGTH} chars)` },
      { status: 400 },
    );
  }
  if (body.sample.length > MAX_SAMPLE_LENGTH) {
    return NextResponse.json(
      { error: `Sample too long (max ${MAX_SAMPLE_LENGTH} chars)` },
      { status: 400 },
    );
  }

  try {
    const result = await call({
      model: DEFAULT_MODEL,
      system: body.prompt,
      messages: [{ role: "user", content: body.sample }],
      maxTokens: MAX_OUTPUT_TOKENS,
    });

    const output = result.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n\n")
      .trim();

    return NextResponse.json({
      ok: true,
      output,
      model: DEFAULT_MODEL,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      totalTokens: result.tokens,
      stopReason: result.stopReason,
    });
  } catch (err) {
    console.error("Failed to run prompt test", err);
    const message = err instanceof Error ? err.message : "Failed to run test";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  buildSandboxReadinessReport,
  runSandboxReadinessAction,
  type SandboxReadinessAction,
} from "@/lib/sandbox-readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReadinessBody = {
  action?: SandboxReadinessAction;
  mode?: string | null;
  chatModel?: string | null;
  voiceModel?: string | null;
};

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const search = req.nextUrl.searchParams;
  try {
    const report = await buildSandboxReadinessReport({
      characterIdOrSlug: id,
      mode: search.get("mode"),
      chatModel: search.get("chatModel") ?? search.get("model"),
      voiceModel: search.get("voiceModel"),
    });
    return NextResponse.json({ report });
  } catch (err) {
    return readinessError(err);
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let body: ReadinessBody;
  try {
    body = (await req.json()) as ReadinessBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isReadinessAction(body.action)) {
    return NextResponse.json(
      {
        error:
          "action must be one of check_model, check_tts, check_stt, check_persistence, run_all.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await runSandboxReadinessAction({
      characterIdOrSlug: id,
      action: body.action,
      mode: body.mode,
      chatModel: body.chatModel,
      voiceModel: body.voiceModel,
    });
    return NextResponse.json({ result });
  } catch (err) {
    return readinessError(err);
  }
}

function isReadinessAction(value: unknown): value is SandboxReadinessAction {
  return (
    value === "check_model" ||
    value === "check_tts" ||
    value === "check_stt" ||
    value === "check_persistence" ||
    value === "run_all"
  );
}

function readinessError(err: unknown) {
  const status =
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status?: unknown }).status === "number"
      ? (err as { status: number }).status
      : 500;
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status });
}

import { NextRequest, NextResponse } from "next/server";
import { getOpenAIClient } from "@odyssey/engine";

const DEFAULT_SYSTEM_PROMPT =
  "You are a concise voice assistant. Respond naturally in 1-3 sentences unless the user asks for more detail.";

function buildFallbackReply(transcript: string) {
  const trimmed = transcript.trim();
  if (!trimmed) {
    return "I did not catch that clearly. Could you repeat it once?";
  }
  return `I heard you say: "${trimmed}". I can continue once the LLM key is fixed.`;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      transcript?: string;
      systemPrompt?: string;
      model?: string;
    };

    const transcript = (body.transcript ?? "").trim();
    if (!transcript) {
      return NextResponse.json({ error: "transcript is required." }, { status: 400 });
    }

    const client = getOpenAIClient();
    if (!client) {
      return NextResponse.json(
        {
          reply: buildFallbackReply(transcript),
          model: "fallback-local",
          provider: "fallback",
          warning: "OPENAI_API_KEY is required for reply generation.",
        },
        { status: 200 },
      );
    }

    const model = (body.model ?? process.env.AUDIO_REPLY_MODEL ?? "gpt-4o-mini").trim();
    const systemPrompt = (body.systemPrompt ?? process.env.AUDIO_REPLY_SYSTEM_PROMPT ?? DEFAULT_SYSTEM_PROMPT).trim();

    const response = await client.responses.create({
      model,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: transcript }],
        },
      ],
    });

    const reply = (response.output_text ?? "").trim();
    if (!reply) {
      return NextResponse.json(
        { error: "LLM returned an empty reply.", model },
        { status: 502 },
      );
    }

    return NextResponse.json({
      reply,
      model,
      provider: "openai",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reply generation failed.";
    const isAuthError =
      message.toLowerCase().includes("incorrect api key") ||
      message.toLowerCase().includes("invalid api key") ||
      message.toLowerCase().includes("authentication");

    if (isAuthError) {
      return NextResponse.json(
        {
          reply: "I can hear you, but the LLM key is invalid right now. Update OPENAI_API_KEY and try again.",
          model: "fallback-local",
          provider: "fallback",
          warning: message,
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}

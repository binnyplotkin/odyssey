import { NextRequest, NextResponse } from "next/server";
import { getOpenAIClient } from "@odyssey/engine";

const DEFAULT_SYSTEM_PROMPT =
  "You are a concise voice assistant. Respond naturally in 1-3 sentences unless the user asks for more detail.";

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
        { error: "OPENAI_API_KEY is required for reply generation." },
        { status: 503 },
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Reply generation failed." },
      { status: 500 },
    );
  }
}

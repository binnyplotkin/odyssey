import { NextRequest, NextResponse } from "next/server";
import { getOpenAIClient } from "@odyssey/engine";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      characterName: string;
      archetype: string;
      personality: string;
      scenario: string;
    };

    const { characterName, archetype, personality, scenario } = body;

    if (!characterName || !scenario) {
      return NextResponse.json(
        { error: "characterName and scenario are required." },
        { status: 400 }
      );
    }

    const openai = getOpenAIClient();

    if (!openai) {
      // Fallback: generate a deterministic mock response
      const mockResponses: Record<string, string> = {
        advisor: `"Your Majesty, I counsel patience. History teaches us that rash action breeds further instability. Let us convene the council and consider our options with the gravity this moment demands."`,
        priest: `"The Divine watches, my liege. There is a path of righteousness here, if only we have the courage to seek it. Let mercy temper justice, as the scriptures command."`,
        noble: `"How... fascinating. One wonders what opportunities might arise from such turmoil. I'm certain my estates could contribute — for the right considerations, of course."`,
        military: `"We act now or we lose the initiative. Give me two companies and twelve hours. I'll have a defensive perimeter that buys us time. Deliberation is a luxury we cannot afford."`,
      };

      return NextResponse.json({
        response:
          mockResponses[archetype] ||
          `${characterName} considers the situation carefully before responding.`,
        tokenCount: 50,
        model: "fallback",
      });
    }

    const systemPrompt = `You are ${characterName}, a ${archetype} character in a medieval kingdom simulation.

PERSONALITY: ${personality}

RULES:
- Stay completely in character as ${characterName}
- Respond in first person as this character would speak
- Your response should reflect your archetype's worldview, vocabulary, and priorities
- Keep response to 2-3 sentences maximum
- Do NOT break character or reference being an AI
- Your speaking style must be distinctly different from other character types`;

    const startTime = Date.now();

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      instructions: systemPrompt,
      input: `The following situation has occurred in the royal court:\n\n${scenario}\n\nHow do you respond? Speak in character.`,
      temperature: 0.8,
    });

    const responseText =
      response.output_text || "The character remains silent.";
    const elapsed = Date.now() - startTime;

    // Rough token estimate (4 chars per token)
    const inputTokens = Math.ceil(
      (systemPrompt.length + scenario.length) / 4
    );
    const outputTokens = Math.ceil(responseText.length / 4);

    return NextResponse.json({
      response: responseText,
      tokenCount: inputTokens + outputTokens,
      inputTokens,
      outputTokens,
      latency: elapsed,
      model: "gpt-4.1-mini",
    });
  } catch (error) {
    console.error("Character test error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}

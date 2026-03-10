import { getOpenAIClient } from "@/lib/openai/client";
import { TextGenerationAdapter } from "@/lib/simulation/interfaces";
import { createId } from "@/lib/utils";
import { EventTemplate, SimulationState, TurnInput, TurnResult, WorldDefinition } from "@/types/simulation";

function fallbackOutput(params: {
  world: WorldDefinition;
  activeEvent: EventTemplate | null;
  input: TurnInput;
}): Pick<TurnResult, "narration" | "dialogue" | "uiChoices" | "audioDirectives"> {
  const { world, activeEvent, input } = params;
  const actors = activeEvent
    ? world.characters.filter((character) => activeEvent.actorIds.includes(character.id))
    : world.characters.slice(0, 2);

  const narrationText = activeEvent
    ? `${activeEvent.title}. ${activeEvent.summary} The chamber recalibrates around your command: "${input.text}".`
    : `${world.introNarration} Your latest order echoes through the room: "${input.text}".`;

  return {
    narration: [
      {
        id: createId("narration"),
        speaker: "narrator",
        text: narrationText,
      },
    ],
    dialogue: actors.map((character, index) => ({
      id: createId("dialogue"),
      speaker: character.name,
      role: character.title,
      emotion: index === 0 ? "urgent" : "skeptical",
      text:
        index === 0
          ? `${character.name} responds in ${character.speakingStyle.toLowerCase()} terms, measuring how your choice shifts the balance of power.`
          : `${character.name} weighs the public and political cost, watching for weakness or resolve in equal measure.`,
    })),
    uiChoices: [
      "Ask an advisor for counsel",
      "Issue a direct order",
      "Question the petitioner further",
    ],
    audioDirectives: [
      {
        type: "speak",
        voice: "alloy",
        text: narrationText,
      },
      {
        type: "await-input",
        voice: "alloy",
        text: "The court waits for your next decree.",
      },
    ],
  };
}

export class OpenAITextGenerator implements TextGenerationAdapter {
  async generateTurn(params: {
    world: WorldDefinition;
    state: SimulationState;
    activeEvent: EventTemplate | null;
    input: TurnInput;
  }) {
    const client = getOpenAIClient();

    if (!client) {
      return fallbackOutput(params);
    }

    const completion = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "You are the orchestration layer for Pandora's Box.",
                "Respond as JSON with keys narration, dialogue, uiChoices, audioDirectives.",
                "Keep the world coherent, historically grounded, and politically consequential.",
                `World: ${params.world.title}.`,
                `Setting: ${params.world.setting}.`,
                `Norms: ${params.world.norms.join(" | ")}.`,
                `State: stability ${params.state.politicalStability}, sentiment ${params.state.publicSentiment}, treasury ${params.state.treasury}, military ${params.state.militaryPressure}.`,
                params.activeEvent
                  ? `Active event: ${params.activeEvent.title} - ${params.activeEvent.summary}.`
                  : "No active event selected.",
              ].join(" "),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: params.input.text,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "turn_response",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              narration: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    id: { type: "string" },
                    speaker: { type: "string", enum: ["narrator"] },
                    text: { type: "string" },
                  },
                  required: ["id", "speaker", "text"],
                },
              },
              dialogue: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    id: { type: "string" },
                    speaker: { type: "string" },
                    role: { type: "string" },
                    emotion: {
                      type: "string",
                      enum: ["calm", "urgent", "skeptical", "angry", "hopeful", "grieved"],
                    },
                    text: { type: "string" },
                  },
                  required: ["id", "speaker", "role", "emotion", "text"],
                },
              },
              uiChoices: {
                type: "array",
                items: { type: "string" },
              },
              audioDirectives: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    type: { type: "string", enum: ["speak", "await-input"] },
                    voice: { type: "string" },
                    text: { type: "string" },
                  },
                  required: ["type", "voice", "text"],
                },
              },
            },
            required: ["narration", "dialogue", "uiChoices", "audioDirectives"],
          },
        },
      },
    });

    const text = completion.output_text;

    if (!text) {
      return fallbackOutput(params);
    }

    const parsed = JSON.parse(text) as Pick<
      TurnResult,
      "narration" | "dialogue" | "uiChoices" | "audioDirectives"
    >;

    return parsed;
  }
}

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
    ? `${activeEvent.title}. ${activeEvent.summary} The situation shifts around your choice: "${input.text}".`
    : `${world.introNarration} Your latest action reshapes the scene: "${input.text}".`;

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
      "Ask for more context",
      "Commit to a direct action",
      "Probe for hidden consequences",
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
        text: "The scenario waits for your next move.",
      },
    ],
  };
}

function buildResponseRequest(params: {
  world: WorldDefinition;
  state: SimulationState;
  activeEvent: EventTemplate | null;
  input: TurnInput;
}) {
  return {
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system" as const,
        content: [
          {
            type: "input_text" as const,
            text: [
              "You are the orchestration layer for Pandora's Box.",
              "Respond as JSON with keys narration, dialogue, uiChoices, audioDirectives.",
              "Keep the world coherent, grounded in the provided setting, and consequential.",
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
        role: "user" as const,
        content: [
          {
            type: "input_text" as const,
            text: params.input.text,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema" as const,
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
  };
}

type ObjectContext = {
  type: "object";
  mode: "expectKeyOrEnd" | "expectColon" | "expectValue" | "expectCommaOrEnd";
  currentKey: string | null;
  field?: string;
};

type ArrayContext = {
  type: "array";
  mode: "expectValueOrEnd" | "expectCommaOrEnd";
  field?: string;
};

type JsonContext = ObjectContext | ArrayContext;

class StructuredTextDeltaExtractor {
  private readonly stack: JsonContext[] = [];

  private inString = false;
  private stringIsKey = false;
  private captureValueString = false;
  private pendingSeparator = false;
  private escape = false;
  private unicodeDigitsRemaining = 0;
  private unicodeBuffer = "";
  private currentString = "";
  private emittedAny = false;
  private emittedText = "";

  getOutput() {
    return this.emittedText;
  }

  feed(chunk: string) {
    let output = "";

    for (const char of chunk) {
      if (this.inString) {
        if (this.unicodeDigitsRemaining > 0) {
          this.unicodeBuffer += char;
          this.unicodeDigitsRemaining -= 1;

          if (this.unicodeDigitsRemaining === 0) {
            const codePoint = Number.parseInt(this.unicodeBuffer, 16);
            const decoded = Number.isFinite(codePoint)
              ? String.fromCharCode(codePoint)
              : "";
            output += this.consumeStringCharacter(decoded);
            this.unicodeBuffer = "";
          }

          continue;
        }

        if (this.escape) {
          this.escape = false;

          if (char === "u") {
            this.unicodeDigitsRemaining = 4;
            this.unicodeBuffer = "";
            continue;
          }

          const decodedEscapes: Record<string, string> = {
            '"': '"',
            "\\": "\\",
            "/": "/",
            b: "\b",
            f: "\f",
            n: "\n",
            r: "\r",
            t: "\t",
          };
          output += this.consumeStringCharacter(decodedEscapes[char] ?? char);
          continue;
        }

        if (char === "\\") {
          this.escape = true;
          continue;
        }

        if (char === '"') {
          this.finishString();
          continue;
        }

        output += this.consumeStringCharacter(char);
        continue;
      }

      if (char === " " || char === "\n" || char === "\r" || char === "\t") {
        continue;
      }

      if (char === "{") {
        this.consumeValueStart();
        this.stack.push({
          type: "object",
          mode: "expectKeyOrEnd",
          currentKey: null,
          field: this.currentValueField(),
        });
        continue;
      }

      if (char === "[") {
        this.consumeValueStart();
        this.stack.push({
          type: "array",
          mode: "expectValueOrEnd",
          field: this.currentValueField(),
        });
        continue;
      }

      if (char === "}") {
        this.stack.pop();
        continue;
      }

      if (char === "]") {
        this.stack.pop();
        continue;
      }

      if (char === ",") {
        const top = this.top();
        if (!top) {
          continue;
        }

        if (top.type === "object" && top.mode === "expectCommaOrEnd") {
          top.mode = "expectKeyOrEnd";
          top.currentKey = null;
          continue;
        }

        if (top.type === "array" && top.mode === "expectCommaOrEnd") {
          top.mode = "expectValueOrEnd";
        }
        continue;
      }

      if (char === ":") {
        const top = this.top();
        if (top?.type === "object" && top.mode === "expectColon") {
          top.mode = "expectValue";
        }
        continue;
      }

      if (char === '"') {
        this.startString();
        continue;
      }

      this.consumeLiteral();
    }

    return output;
  }

  private top() {
    return this.stack[this.stack.length - 1];
  }

  private consumeValueStart() {
    const top = this.top();
    if (!top) {
      return;
    }

    if (top.type === "object" && top.mode === "expectValue") {
      top.mode = "expectCommaOrEnd";
      return;
    }

    if (top.type === "array" && top.mode === "expectValueOrEnd") {
      top.mode = "expectCommaOrEnd";
    }
  }

  private consumeLiteral() {
    const top = this.top();
    if (!top) {
      return;
    }

    if (top.type === "object" && top.mode === "expectValue") {
      top.mode = "expectCommaOrEnd";
      return;
    }

    if (top.type === "array" && top.mode === "expectValueOrEnd") {
      top.mode = "expectCommaOrEnd";
    }
  }

  private currentValueField() {
    const top = this.top();
    if (!top) {
      return undefined;
    }

    if (top.type === "object" && top.mode === "expectValue") {
      return top.currentKey ?? undefined;
    }

    if (top.type === "array" && top.mode === "expectValueOrEnd") {
      return top.field;
    }

    return undefined;
  }

  private nearestArrayField() {
    for (let index = this.stack.length - 1; index >= 0; index -= 1) {
      const context = this.stack[index];
      if (context.type === "array" && context.field) {
        return context.field;
      }
    }

    return undefined;
  }

  private startString() {
    const top = this.top();
    this.inString = true;
    this.escape = false;
    this.unicodeDigitsRemaining = 0;
    this.unicodeBuffer = "";
    this.currentString = "";

    if (top?.type === "object" && top.mode === "expectKeyOrEnd") {
      this.stringIsKey = true;
      this.captureValueString = false;
      this.pendingSeparator = false;
      return;
    }

    this.stringIsKey = false;
    this.pendingSeparator = false;
    this.captureValueString = false;

    const canCapture =
      top?.type === "object" &&
      top.mode === "expectValue" &&
      top.currentKey === "text";

    if (!canCapture) {
      return;
    }

    const collectionField = this.nearestArrayField();
    if (collectionField !== "narration" && collectionField !== "dialogue") {
      return;
    }

    this.captureValueString = true;
    this.pendingSeparator = this.emittedAny;
  }

  private consumeStringCharacter(char: string) {
    if (this.stringIsKey) {
      this.currentString += char;
      return "";
    }

    if (!this.captureValueString) {
      return "";
    }

    let output = "";
    if (this.pendingSeparator) {
      output += "\n\n";
      this.pendingSeparator = false;
      this.emittedAny = true;
      this.emittedText += "\n\n";
    }

    output += char;
    this.emittedAny = true;
    this.emittedText += char;
    return output;
  }

  private finishString() {
    const top = this.top();
    if (this.stringIsKey) {
      if (top?.type === "object" && top.mode === "expectKeyOrEnd") {
        top.currentKey = this.currentString;
        top.mode = "expectColon";
      }
    } else if (top?.type === "object" && top.mode === "expectValue") {
      top.mode = "expectCommaOrEnd";
    } else if (top?.type === "array" && top.mode === "expectValueOrEnd") {
      top.mode = "expectCommaOrEnd";
    }

    this.inString = false;
    this.stringIsKey = false;
    this.captureValueString = false;
    this.pendingSeparator = false;
    this.escape = false;
    this.unicodeDigitsRemaining = 0;
    this.unicodeBuffer = "";
    this.currentString = "";
  }
}

function buildDisplayTextFromParsedTurn(
  parsed: Pick<TurnResult, "narration" | "dialogue">,
) {
  return [
    ...parsed.narration.map((item) => item.text),
    ...parsed.dialogue.map((item) => item.text),
  ].join("\n\n");
}

export class OpenAITextGenerator implements TextGenerationAdapter {
  async generateTurn(params: {
    world: WorldDefinition;
    state: SimulationState;
    activeEvent: EventTemplate | null;
    input: TurnInput;
    onTextDelta?: (delta: string) => void | Promise<void>;
  }) {
    const client = getOpenAIClient();

    if (!client) {
      const fallback = fallbackOutput(params);
      if (params.onTextDelta) {
        const preview = [
          ...fallback.narration.map((item) => item.text),
          ...fallback.dialogue.map((item) => item.text),
        ].join("\n\n");

        if (preview) {
          await params.onTextDelta(preview);
        }
      }

      return fallback;
    }

    const requestBody = buildResponseRequest(params);
    let text = "";

    if (params.onTextDelta) {
      const stream = client.responses.stream(requestBody);
      let streamed = "";
      const extractor = new StructuredTextDeltaExtractor();
      let emittedDisplay = "";

      for await (const event of stream) {
        if (event.type !== "response.output_text.delta") {
          continue;
        }

        streamed += event.delta;
        const delta = extractor.feed(event.delta);
        if (delta) {
          emittedDisplay += delta;
          await params.onTextDelta(delta);
        }
      }

      const finalResponse = await stream.finalResponse();
      text = finalResponse.output_text ?? streamed;

      const parsedFromStream = JSON.parse(text) as Pick<
        TurnResult,
        "narration" | "dialogue" | "uiChoices" | "audioDirectives"
      >;
      const finalDisplay = buildDisplayTextFromParsedTurn(parsedFromStream);
      if (finalDisplay.startsWith(emittedDisplay) && finalDisplay.length > emittedDisplay.length) {
        await params.onTextDelta(finalDisplay.slice(emittedDisplay.length));
      }
      return parsedFromStream;
    } else {
      const completion = await client.responses.create(requestBody);
      text = completion.output_text ?? "";
    }

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

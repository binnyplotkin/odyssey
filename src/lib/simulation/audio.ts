import { getOpenAIClient } from "@/lib/openai/client";
import { SpeechToTextAdapter, TextToSpeechAdapter } from "@/lib/simulation/interfaces";

export class OpenAISpeechToTextAdapter implements SpeechToTextAdapter {
  async transcribe({ audioBase64, mimeType }: { audioBase64: string; mimeType: string }) {
    const client = getOpenAIClient();

    if (!client) {
      throw new Error("OPENAI_API_KEY is required for speech transcription.");
    }

    const transcription = await client.audio.transcriptions.create({
      file: await fetch(`data:${mimeType};base64,${audioBase64}`).then(async (response) => {
        const blob = await response.blob();
        return new File([blob], "turn.webm", { type: mimeType });
      }),
      model: "gpt-4o-mini-transcribe",
    });

    return transcription.text;
  }
}

export class OpenAITextToSpeechAdapter implements TextToSpeechAdapter {
  async synthesize({ text, voice }: { text: string; voice: string }) {
    const client = getOpenAIClient();

    if (!client) {
      return null;
    }

    const audio = await client.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice,
      input: text,
      response_format: "mp3",
    });

    const buffer = Buffer.from(await audio.arrayBuffer());

    return {
      audioBase64: buffer.toString("base64"),
      mimeType: "audio/mpeg",
    };
  }
}

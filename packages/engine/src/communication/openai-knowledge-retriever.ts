import { getOpenAIClient } from "../openai-client";
import { ExternalKnowledgeRetriever, RetrievedDocument, RetrievalContext } from "./retrieval-layer";

export class OpenAIWebKnowledgeRetriever implements ExternalKnowledgeRetriever {
  async retrieve(context: RetrievalContext): Promise<RetrievedDocument[]> {
    const client = getOpenAIClient();
    if (!client) {
      return [];
    }

    try {
      const response = await client.responses.create({
        model: "gpt-4.1-mini",
        tools: [{ type: "web_search_preview" as const }],
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "Retrieve concise facts for simulation grounding. Return only JSON with neutral, factual summaries.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Retrieve up to 6 relevant sources for this simulation context:
Scenario: ${context.scenarioType}
Role: ${context.role}
Industry: ${context.industry}
Goal: ${context.goal}
Knowledge domain: ${context.constraints?.knowledgeDomain ?? context.industry}

Return JSON array items with: title, excerpt, url, publishedAt, relevance(0-1).`,
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "retrieved_docs",
            schema: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  excerpt: { type: "string" },
                  url: { type: ["string", "null"] },
                  publishedAt: { type: ["string", "null"] },
                  relevance: { type: "number", minimum: 0, maximum: 1 },
                },
                required: ["title", "excerpt", "url", "publishedAt", "relevance"],
              },
            },
          },
        },
      });

      const parsed = JSON.parse(response.output_text ?? "[]") as Array<{
        title: string;
        excerpt: string;
        url: string | null;
        publishedAt: string | null;
        relevance: number;
      }>;

      return parsed.map((item) => ({
        title: item.title,
        excerpt: item.excerpt,
        url: item.url ?? undefined,
        publishedAt: item.publishedAt ?? undefined,
        relevance: item.relevance,
      }));
    } catch {
      return [];
    }
  }
}


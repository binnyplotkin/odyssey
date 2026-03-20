import { isoNow } from "@odyssey/utils";
import {
  RealismMode,
  SpecificityLevel,
  WorldKnowledgeFact,
  WorldKnowledgeModel,
  WorldScenarioType,
} from "./types";

export type RetrievalContext = {
  scenarioType: WorldScenarioType;
  realismMode: RealismMode;
  role: string;
  industry: string;
  goal: string;
  specificityLevel: SpecificityLevel;
  constraints?: {
    knowledgeDomain?: string;
    pressurePattern?: string;
    scenarioStructure?: string;
  };
};

export type RetrievedDocument = {
  title: string;
  excerpt: string;
  url?: string;
  publishedAt?: string;
  relevance?: number;
};

export interface ExternalKnowledgeRetriever {
  retrieve(context: RetrievalContext): Promise<RetrievedDocument[]>;
}

export interface KnowledgeTransformer {
  transform(
    context: RetrievalContext,
    docs: RetrievedDocument[],
    baseModel: WorldKnowledgeModel,
  ): WorldKnowledgeModel;
}

export function shouldActivateRetrieval(context: RetrievalContext) {
  if (context.realismMode === "fictional") {
    return false;
  }
  if (context.realismMode === "real-world-grounded") {
    return true;
  }

  const roleLower = context.role.toLowerCase();
  const industryLower = context.industry.toLowerCase();
  const goalLower = context.goal.toLowerCase();
  const hasNamedOrg = /\b(at|for)\s+[A-Z][a-zA-Z0-9.&-]+/.test(context.role);
  const hasCurrentNeed =
    /current|latest|recent|today|trend|market|public figure|news|regulation/.test(goalLower) ||
    /finance|healthcare|law|policy|geopolitics/.test(industryLower);
  const historicalNeed = /historical|napoleon|ww2|civilization|era/.test(goalLower);
  const specificityNeed = context.specificityLevel === "high";
  const domainNeed =
    /quant|trading|consulting|technical|case interview|industry practice/.test(roleLower);

  return hasNamedOrg || hasCurrentNeed || historicalNeed || specificityNeed || domainNeed;
}

function buildFact(
  kind: "stable" | "current" | "invented",
  topic: string,
  summary: string,
  confidence: number,
  sourceLabel: string,
  sourceUrl?: string,
): WorldKnowledgeFact {
  return {
    id: `fact_${Math.random().toString(36).slice(2, 10)}`,
    kind,
    topic,
    summary,
    confidence: Math.max(0, Math.min(1, confidence)),
    sourceLabel,
    sourceUrl,
  };
}

export function buildBaseKnowledgeModel(context: RetrievalContext): WorldKnowledgeModel {
  const stable: WorldKnowledgeFact[] = [
    buildFact(
      "stable",
      "Scenario Domain",
      `Primary domain is ${context.constraints?.knowledgeDomain ?? context.industry}.`,
      0.7,
      "engine-defaults",
    ),
  ];

  const invented: WorldKnowledgeFact[] =
    context.realismMode === "real-world-grounded"
      ? []
      : [
          buildFact(
            "invented",
            "Simulation Stakes",
            `Core objective: ${context.goal}`,
            0.8,
            "scenario-input",
          ),
        ];

  if (context.constraints?.pressurePattern) {
    invented.push(
      buildFact(
        "invented",
        "Pressure Pattern",
        context.constraints.pressurePattern,
        0.8,
        "scenario-input",
      ),
    );
  }

  return {
    stableFacts: stable,
    currentFacts: [],
    inventedFacts: invented,
    retrieval: {
      used: false,
      generatedAt: isoNow(),
      sources: [],
      notes: "No external retrieval used; defaults and input constraints applied.",
    },
  };
}

export class HeuristicKnowledgeTransformer implements KnowledgeTransformer {
  transform(
    _context: RetrievalContext,
    docs: RetrievedDocument[],
    baseModel: WorldKnowledgeModel,
  ): WorldKnowledgeModel {
    if (!docs.length) {
      return baseModel;
    }

    const nowYear = new Date().getUTCFullYear();
    const stableFacts = [...baseModel.stableFacts];
    const currentFacts = [...baseModel.currentFacts];

    docs.forEach((doc) => {
      const publishedYear = doc.publishedAt ? Number(doc.publishedAt.slice(0, 4)) : NaN;
      const isCurrent = Number.isFinite(publishedYear) && nowYear - publishedYear <= 2;
      const summary = doc.excerpt.trim().slice(0, 260);
      const topic = doc.title.trim().slice(0, 120);
      const fact = buildFact(
        isCurrent ? "current" : "stable",
        topic,
        summary,
        doc.relevance ?? 0.7,
        doc.url ? "retrieved-source" : "retrieved-summary",
        doc.url,
      );

      if (isCurrent) {
        currentFacts.push(fact);
      } else {
        stableFacts.push(fact);
      }
    });

    return {
      ...baseModel,
      stableFacts,
      currentFacts,
      retrieval: {
        used: true,
        generatedAt: isoNow(),
        sources: docs.map((doc) => doc.url).filter((item): item is string => Boolean(item)),
        notes: "External retrieval applied; facts normalized into stable/current channels.",
      },
    };
  }
}

export class NullKnowledgeRetriever implements ExternalKnowledgeRetriever {
  async retrieve(): Promise<RetrievedDocument[]> {
    return [];
  }
}

export function summarizeKnowledgeForPrompt(model: WorldKnowledgeModel) {
  const stable = model.stableFacts.slice(0, 1).map((fact) => fact.summary);
  const current = model.currentFacts.slice(0, 1).map((fact) => fact.summary);
  return [...stable, ...current].join(" ");
}

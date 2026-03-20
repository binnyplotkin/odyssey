import { NextRequest, NextResponse } from "next/server";
import { getOpenAIClient } from "@odyssey/engine";

type InterviewType =
  | "job-interview"
  | "technical-interview"
  | "case-interview"
  | "startup-pitch"
  | "panel-presentation"
  | "press-interview"
  | "high-stakes-qa";

type Profile = {
  jobType: string;
  interviewType: InterviewType;
  industry: string;
  difficultyLevel: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  interviewerCount: number;
  tone: "supportive" | "balanced" | "aggressive";
  timeLimitMinutes: number;
  realismMode: "fictional" | "real-world-grounded" | "hybrid";
  specificityLevel: "broad" | "balanced" | "high";
  constraints?: {
    characterRoles?: string[];
    emotionalDynamics?: string;
    scenarioStructure?: string;
    knowledgeDomain?: string;
    toneStyle?: string;
    environmentalDetails?: string;
    pressurePattern?: string;
  };
  company: string | null;
  confidence: number;
  reasoning: string;
  webEnhanced: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function toTitleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function extractRoleAndCompany(query: string) {
  const trimmed = query.trim().replace(/[.!?]+$/, "");
  const match = trimmed.match(/(.+?)\s+(?:at|for)\s+([a-z0-9.&,\- ]+)$/i);

  if (!match) {
    return { role: null as string | null, company: null as string | null };
  }

  const roleRaw = match[1]
    .replace(
      /^(i want to |i'm |im |i am |please |help me |practice |prepare |for |an |a |the )+/i,
      "",
    )
    .replace(/^(interview|interviewing)\s+(for\s+)?/i, "")
    .replace(/^as\s+(a|an)\s+/i, "")
    .replace(/^for\s+/i, "")
    .replace(/\b(position|role|interview)\b/gi, "")
    .replace(/\b(chasier)\b/gi, "cashier")
    .trim();
  const companyRaw = match[2]
    .replace(/^(the company|company)\s+/i, "")
    .replace(/[.,;]+$/, "")
    .trim();

  const normalizedCompany =
    /mcdonald|mcdonals|mcdonalds/.test(companyRaw.toLowerCase())
      ? "McDonald's"
      : /chick[\s\-]?fil[\s\-]?a/.test(companyRaw.toLowerCase())
        ? "Chick-fil-A"
        : /starbucks/.test(companyRaw.toLowerCase())
          ? "Starbucks"
          : companyRaw;

  return {
    role: roleRaw.length ? roleRaw : null,
    company: normalizedCompany.length ? normalizedCompany : null,
  };
}

function heuristicProfile(query: string): Profile {
  const lower = query.toLowerCase();
  const janeStreet = /jane\s*street|janestreet|jantestreet/.test(lower);
  const technical =
    janeStreet ||
    /technical|engineer|coding|software|quant|trading|system design|developer|data scientist|analyst/.test(
      lower,
    );
  const marketing = /marketing|growth|brand|demand gen|product marketing/.test(lower);
  const rokt = /rokt/.test(lower);
  const caseInterview = /case|consulting|mckinsey|bain|bcg/.test(lower);
  const startupPitch = /pitch|investor|fundraise|vc/.test(lower);
  const panel = /panel/.test(lower);
  const press = /press|media/.test(lower);
  const highStakesQa = /high[-\s]?stakes q&a|high[-\s]?stakes qa/.test(lower);
  const serviceRole =
    /cashier|crew|barista|server|host|waiter|waitress|front counter|customer service|retail|store associate|restaurant/.test(
      lower,
    );
  const mcdonalds = /mcdonald|mcdonald|mcdonals|mcdonald's/.test(lower);
  const starbucks = /starbucks/.test(lower);
  const chickFilA = /chick[\s\-]?fil[\s\-]?a/.test(lower);
  const specificityLevel =
    query.length > 180 ||
    /\n|phase|flow|structure|environment|tone|pressure|constraints|dynamics|roles/.test(lower)
      ? ("high" as const)
      : query.length > 80 || /at |for |with |under/.test(lower)
        ? ("balanced" as const)
        : ("broad" as const);
  const interviewType: InterviewType = janeStreet
    ? "technical-interview"
    : caseInterview
      ? "case-interview"
      : startupPitch
        ? "startup-pitch"
        : panel
          ? "panel-presentation"
          : press
            ? "press-interview"
            : highStakesQa
              ? "high-stakes-qa"
              : technical
                ? "technical-interview"
                : "job-interview";

  const difficulty = janeStreet
    ? 10
    : serviceRole && mcdonalds
      ? 1
      : serviceRole && (starbucks || chickFilA)
        ? 2
        : serviceRole
          ? 3
          : rokt && marketing
            ? 7
            : marketing
              ? 6
              : technical
                ? 7
                : 5;
  const tone =
    janeStreet ? "aggressive" : serviceRole ? "supportive" : difficulty >= 4 ? "balanced" : "balanced";
  const interviewerCount = janeStreet ? 3 : panel ? 3 : 2;
  const timeLimitMinutes = janeStreet ? 300 : serviceRole ? 18 : technical ? 35 : 30;
  const extracted = extractRoleAndCompany(query);
  const company = extracted.company;
  const extractedRole = extracted.role;
  const realismMode = janeStreet || company || /real|current|latest|historical|industry/.test(lower)
    ? ("real-world-grounded" as const)
    : specificityLevel === "high"
      ? ("hybrid" as const)
      : ("hybrid" as const);
  const jobLabelBase = janeStreet
    ? "Jane Street Quant Interview Candidate"
    : serviceRole
      ? "Service Crew Candidate"
    : marketing
      ? "Marketing Interview Candidate"
      : technical
        ? "Technical Interview Candidate"
        : "General Interview Candidate";
  const titledRole = extractedRole ? toTitleCase(extractedRole) : null;
  const jobType = titledRole
    ? company
      ? `${titledRole} at ${company}`
      : titledRole
    : company
      ? `${jobLabelBase} at ${company}`
      : jobLabelBase;

  const constraints: Profile["constraints"] =
    specificityLevel === "broad"
      ? undefined
      : {
          characterRoles: lower.includes("panel")
            ? ["lead interviewer", "panel member"]
            : lower.includes("manager") || lower.includes("crew")
              ? ["manager", "candidate"]
              : undefined,
          emotionalDynamics: /nervous|pressure|skeptical|supportive|aggressive/.test(lower)
            ? "adapt to user confidence and maintain realistic social pressure"
            : undefined,
          scenarioStructure: /arrival|warm-up|deep|closing|flow/.test(lower)
            ? "arrival, warm-up, core evaluation, deep-dive, closing"
            : undefined,
          knowledgeDomain: company ?? (technical ? "technical role domain" : marketing ? "marketing domain" : undefined),
          toneStyle: serviceRole ? "casual practical language" : technical ? "precise and analytical" : "professional",
          environmentalDetails: serviceRole
            ? "active workplace ambience with light interruptions"
            : technical
              ? "quiet focused room"
              : "professional interview setting",
          pressurePattern: janeStreet
            ? "high, analytical, time-pressured"
            : serviceRole
              ? "low-to-moderate social pressure"
              : "moderate evaluative pressure",
        };

  return {
    jobType,
    interviewType,
    industry: janeStreet
      ? "Finance"
      : serviceRole
        ? "Service & Retail"
        : marketing
          ? "Marketing"
          : technical
            ? "Technology"
            : "General",
    difficultyLevel: clamp(difficulty, 1, 10) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
    interviewerCount: clamp(interviewerCount, 1, 5),
    tone,
    timeLimitMinutes: clamp(timeLimitMinutes, 15, 300),
    realismMode,
    specificityLevel,
    constraints,
    company,
    confidence: 0.45,
    reasoning:
      "Heuristic mapping based on detected role/company intent and interview keywords.",
    webEnhanced: false,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { query?: string };
    const query = body.query?.trim();

    if (!query) {
      return NextResponse.json({ error: "query is required." }, { status: 400 });
    }

    const fallback = heuristicProfile(query);
    const client = getOpenAIClient();

    if (!client) {
      return NextResponse.json({ profile: fallback });
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
                  "You generate interview simulation profiles. Use web search for company/interview context when helpful. For sparse prompts, infer plausible defaults. For detailed prompts, preserve specificity in tone, dynamics, structure, environment, and pressure pattern. For entry-level service roles (cashier, crew, retail), keep difficulty low and tone conversational. Return JSON only.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Create an interview simulation profile for: "${query}".
Decide interview type, realistic difficulty (1-10), interviewer count, tone, and time limit.
If input is vague, default to general interview at L5.
If company implies harder process, increase difficulty accordingly.
Infer specificity level (broad/balanced/high) and include constraints when details are provided.
`,
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "interview_profile",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                jobType: { type: "string" },
                interviewType: {
                  type: "string",
                  enum: [
                    "job-interview",
                    "technical-interview",
                    "case-interview",
                    "startup-pitch",
                    "panel-presentation",
                    "press-interview",
                    "high-stakes-qa",
                  ],
                },
                industry: { type: "string" },
                difficultyLevel: { type: "integer", minimum: 1, maximum: 10 },
                interviewerCount: { type: "integer", minimum: 1, maximum: 5 },
                tone: {
                  type: "string",
                  enum: ["supportive", "balanced", "aggressive"],
                },
                timeLimitMinutes: { type: "integer", minimum: 15, maximum: 300 },
                realismMode: {
                  type: "string",
                  enum: ["fictional", "real-world-grounded", "hybrid"],
                },
                specificityLevel: {
                  type: "string",
                  enum: ["broad", "balanced", "high"],
                },
                constraints: {
                  type: ["object", "null"],
                  additionalProperties: false,
                  properties: {
                    characterRoles: { type: ["array", "null"], items: { type: "string" } },
                    emotionalDynamics: { type: ["string", "null"] },
                    scenarioStructure: { type: ["string", "null"] },
                    knowledgeDomain: { type: ["string", "null"] },
                    toneStyle: { type: ["string", "null"] },
                    environmentalDetails: { type: ["string", "null"] },
                    pressurePattern: { type: ["string", "null"] },
                  },
                },
                company: { type: ["string", "null"] },
                confidence: { type: "number", minimum: 0, maximum: 1 },
                reasoning: { type: "string" },
              },
              required: [
                "jobType",
                "interviewType",
                "industry",
                "difficultyLevel",
                "interviewerCount",
                "tone",
                "timeLimitMinutes",
                "realismMode",
                "specificityLevel",
                "company",
                "confidence",
                "reasoning",
              ],
            },
          },
        },
      });

      const parsed = JSON.parse(response.output_text ?? "{}") as Omit<Profile, "webEnhanced">;
      const roleWithCompany = fallback.company
        ? fallback.jobType.toLowerCase().includes(fallback.company.toLowerCase())
          ? fallback.jobType
          : `${fallback.jobType} at ${fallback.company}`
        : fallback.jobType;
      const parsedJobType = parsed.jobType?.trim() ?? "";
      const shouldUseFallbackJobType =
        !parsedJobType || /^general interview candidate$/i.test(parsedJobType);
      const profile: Profile = {
        ...fallback,
        ...parsed,
        jobType: shouldUseFallbackJobType ? roleWithCompany : parsedJobType,
        difficultyLevel: clamp(parsed.difficultyLevel ?? fallback.difficultyLevel, 1, 10) as
          | 1
          | 2
          | 3
          | 4
          | 5
          | 6
          | 7
          | 8
          | 9
          | 10,
        interviewerCount: clamp(parsed.interviewerCount ?? fallback.interviewerCount, 1, 5),
        timeLimitMinutes: clamp(parsed.timeLimitMinutes ?? fallback.timeLimitMinutes, 15, 300),
        realismMode: (parsed.realismMode ?? fallback.realismMode) as
          | "fictional"
          | "real-world-grounded"
          | "hybrid",
        specificityLevel: (parsed.specificityLevel ?? fallback.specificityLevel) as
          | "broad"
          | "balanced"
          | "high",
        constraints: parsed.constraints ?? fallback.constraints,
        webEnhanced: true,
      };

      return NextResponse.json({ profile });
    } catch {
      return NextResponse.json({ profile: fallback });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate profile." },
      { status: 500 },
    );
  }
}

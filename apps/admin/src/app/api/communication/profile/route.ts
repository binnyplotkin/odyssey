import { NextRequest, NextResponse } from "next/server";
import { getOpenAIClient } from "@odyssey/engine";

type ScenarioType =
  | "interview"
  | "role-experience"
  | "presentation"
  | "negotiation"
  | "social"
  | "historical-immersion"
  | "classroom"
  | "debate"
  | "training";

type InterviewType =
  | "job-interview"
  | "technical-interview"
  | "case-interview"
  | "startup-pitch"
  | "panel-presentation"
  | "press-interview"
  | "high-stakes-qa";

type Profile = {
  scenarioType: ScenarioType;
  intentGoal:
    | "get-hired"
    | "experience-role"
    | "train-skill"
    | "persuade"
    | "negotiate"
    | "social-dynamics"
    | "historical-immersion"
    | "learn";
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
    .replace(/^simulate working as\s+(a|an)\s+/i, "")
    .replace(/^working as\s+(a|an)\s+/i, "")
    .replace(/^experience being\s+(a|an)\s+/i, "")
    .replace(/^feel what it'?s like to be\s+(a|an)\s+/i, "")
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

function classifyWorldIntent(lower: string): {
  scenarioType: ScenarioType;
  intentGoal: Profile["intentGoal"];
} {
  const interviewIntent =
    /prepare for an? interview|practice interview|interview me|simulate (an|the) interview|hiring process|what would they ask me|get ready for (an|the) interview/.test(
      lower,
    );
  const roleExperienceIntent =
    /feel what (it'?s|it is) like|experience being|simulate working as|let me be in the role|what the job (is|feels) like|simulate a real shift|already in the role/.test(
      lower,
    );

  if (interviewIntent) {
    return { scenarioType: "interview", intentGoal: "get-hired" };
  }
  if (roleExperienceIntent) {
    return { scenarioType: "role-experience", intentGoal: "experience-role" };
  }
  if (/pitch|presentation|public speaking|present to/.test(lower)) {
    return { scenarioType: "presentation", intentGoal: "persuade" };
  }
  if (/negotiat|term sheet|counteroffer|deal terms/.test(lower)) {
    return { scenarioType: "negotiation", intentGoal: "negotiate" };
  }
  if (/debate|argue against|opponent/.test(lower)) {
    return { scenarioType: "debate", intentGoal: "persuade" };
  }
  if (/classroom|teacher|student|lesson|oral exam/.test(lower)) {
    return { scenarioType: "classroom", intentGoal: "learn" };
  }
  if (/historical|history|napoleon|ancient|ww2|civil war/.test(lower)) {
    return { scenarioType: "historical-immersion", intentGoal: "historical-immersion" };
  }
  if (/social|party|networking|dating|friendship|conversation/.test(lower)) {
    return { scenarioType: "social", intentGoal: "social-dynamics" };
  }
  if (/train|practice|drill|rehearse/.test(lower)) {
    return { scenarioType: "training", intentGoal: "train-skill" };
  }
  return { scenarioType: "interview", intentGoal: "get-hired" };
}

function heuristicProfile(query: string): Profile {
  const lower = query.toLowerCase();
  const classification = classifyWorldIntent(lower);
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
  const interviewType: InterviewType =
    classification.scenarioType === "presentation"
      ? "panel-presentation"
      : classification.scenarioType === "negotiation"
        ? "high-stakes-qa"
        : classification.scenarioType === "debate"
          ? "press-interview"
          : classification.scenarioType === "historical-immersion"
            ? "case-interview"
            : classification.scenarioType === "classroom"
              ? "panel-presentation"
              : classification.scenarioType === "social"
                ? "press-interview"
                : classification.scenarioType === "training"
                  ? "high-stakes-qa"
                  : janeStreet
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
  const jobLabelBase =
    classification.scenarioType === "role-experience"
      ? "Role Experience Simulation"
      : classification.scenarioType === "presentation"
        ? "Presentation Simulation"
        : classification.scenarioType === "negotiation"
          ? "Negotiation Simulation"
          : classification.scenarioType === "classroom"
            ? "Classroom Simulation"
            : classification.scenarioType === "debate"
              ? "Debate Simulation"
              : janeStreet
                ? "Jane Street Quant Interview Candidate"
                : serviceRole
                  ? "Service Crew Candidate"
                  : marketing
                    ? "Marketing Interview Candidate"
                    : technical
                      ? "Technical Interview Candidate"
                      : "General Interview Candidate";
  const titledRole = extractedRole ? toTitleCase(extractedRole) : null;
  const roleWithCompany = titledRole
    ? company
      ? `${titledRole} at ${company}`
      : titledRole
    : company
      ? `${jobLabelBase} at ${company}`
      : jobLabelBase;
  const jobType =
    classification.scenarioType === "interview"
      ? company && titledRole
        ? `Applying for ${titledRole} Position at ${company}`
        : `Interview Simulation: ${roleWithCompany}`
      : classification.scenarioType === "role-experience"
        ? company && titledRole
          ? `Working as ${titledRole} at ${company}`
          : `Role Experience: ${roleWithCompany}`
        : roleWithCompany;

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
            ? classification.scenarioType === "interview"
              ? "arrival, warm-up, core evaluation, deep-dive, closing"
              : "introduction, task phase, challenge escalation, outcome phase"
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
    scenarioType: classification.scenarioType,
    intentGoal: classification.intentGoal,
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
      `Heuristic mapping based on detected world intent (${classification.scenarioType}) and role/company language.`,
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
                  "You generate world simulation profiles (not only interviews). Classify intent first, then produce scenario settings. Use web search for company/domain context when helpful. For sparse prompts infer defaults; for detailed prompts preserve specificity. Return JSON only.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Create a world simulation profile for: "${query}".
First classify scenario type (interview, role-experience, presentation, negotiation, social, historical-immersion, classroom, debate, training).
Then set realistic difficulty (1-10), participant count, tone, and time limit.
If input is vague, infer sensible defaults.
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
                scenarioType: {
                  type: "string",
                  enum: [
                    "interview",
                    "role-experience",
                    "presentation",
                    "negotiation",
                    "social",
                    "historical-immersion",
                    "classroom",
                    "debate",
                    "training",
                  ],
                },
                intentGoal: {
                  type: "string",
                  enum: [
                    "get-hired",
                    "experience-role",
                    "train-skill",
                    "persuade",
                    "negotiate",
                    "social-dynamics",
                    "historical-immersion",
                    "learn",
                  ],
                },
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
                "scenarioType",
                "intentGoal",
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

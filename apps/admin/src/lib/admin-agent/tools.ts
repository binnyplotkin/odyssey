import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  getChangelogStore,
  getCharacterStore,
  getDb,
  getEvalStore,
  getFeatureStore,
  getPlatformVersionStore,
  getTicketStore,
  getVersionStore,
  getVoiceStore,
  getWikiStore,
  getWikisStore,
  getSceneSessionStore,
  characterKnowledgeBindingsTable,
  usersTable,
  type AdminAgentOperationRecord,
} from "@odyssey/db";
import type {
  AdminAgentContext,
  AdminAgentDryRunResult,
  AdminAgentExecutionResult,
  AdminAgentMutationTool,
  AdminAgentReadTool,
  AdminAgentTool,
} from "./types";
import {
  inspectRouteSource,
  listProjectFiles,
  readSourceFile,
  searchCode,
} from "./codebase";
import {
  createGitHubIssue,
  createGitHubIssueComment,
  getGitHubIssue,
  getGitHubPullRequestReadiness,
  mergeGitHubPullRequest,
  resolveGitHubRepository,
} from "./github";

const emptySchema = z.object({}).strict();
const limitSchema = z
  .object({ limit: z.number().int().min(1).max(100).optional() })
  .strict();
const idSchema = z.object({ id: z.string().trim().min(1) }).strict();
const nullableString = z.string().trim().optional().nullable();
const optionalNonEmptyString = z.preprocess(
  (value) => (value === null ? undefined : value),
  z.string().trim().min(1).optional(),
);
const optionalInt = (min: number, max: number) =>
  z.preprocess(
    (value) => (value === null ? undefined : value),
    z.number().int().min(min).max(max).optional(),
  );
const optionalStringArray = (maxItems: number, maxChars: number) =>
  z.preprocess(
    (value) => {
      if (value === null) return undefined;
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
          try {
            const parsed = JSON.parse(trimmed) as unknown;
            if (Array.isArray(parsed)) {
              return parsed.map((item) =>
                typeof item === "string" ? item : JSON.stringify(item),
              );
            }
          } catch {
            /* fall back to delimiter split below */
          }
        }
        return trimmed
          .split(/[\n,;|]+/)
          .map((item) => item.trim())
          .filter(Boolean);
      }
      if (!Array.isArray(value)) return value;
      return value.map((item) =>
        typeof item === "string" ? item : JSON.stringify(item),
      );
    },
    z.array(z.string().trim().min(1).max(maxChars)).max(maxItems).optional(),
  );
const codeGlobsSchema = z.array(z.string().trim().min(1)).max(12).optional();
const listProjectFilesSchema = z
  .object({
    globs: codeGlobsSchema,
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();
const readSourceFileSchema = z
  .object({
    path: z.string().trim().min(1),
    maxChars: z.number().int().min(1_000).max(50_000).optional(),
  })
  .strict();
const searchCodeSchema = z
  .object({
    query: z.string().trim().min(2),
    globs: codeGlobsSchema,
    limit: z.number().int().min(1).max(100).optional(),
    maxFileBytes: z.number().int().min(8_000).max(750_000).optional(),
  })
  .strict();
const inspectRouteSourceSchema = z
  .object({
    pathname: z.string().trim().min(1),
    maxCharsPerFile: z.number().int().min(1_000).max(25_000).optional(),
  })
  .strict();
const githubRepositorySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
  .optional();
const getGitHubIssueSchema = z
  .object({
    repository: githubRepositorySchema,
    issueNumber: z.number().int().positive(),
  })
  .strict();
const getGitHubPullRequestStatusSchema = z
  .object({
    repository: githubRepositorySchema,
    pullNumber: z.number().int().positive(),
    expectedHeadSha: z.string().trim().min(7).optional(),
  })
  .strict();
const createCodexCodeTaskSchema = z
  .object({
    repository: githubRepositorySchema,
    title: z.string().trim().min(1).max(160),
    task: z.string().trim().min(10).max(12_000),
    context: z.string().trim().max(8_000).optional().nullable(),
    constraints: z.array(z.string().trim().min(1)).max(20).optional(),
    acceptanceCriteria: z.array(z.string().trim().min(1)).max(20).optional(),
    labels: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
    startCodex: z.boolean().optional().default(true),
  })
  .strict();
const requestCodexOnIssueSchema = z
  .object({
    repository: githubRepositorySchema,
    issueNumber: z.number().int().positive(),
    instructions: z.string().trim().min(10).max(12_000),
  })
  .strict();
const requestCodexOnPullRequestSchema = z
  .object({
    repository: githubRepositorySchema,
    pullNumber: z.number().int().positive(),
    mode: z.enum(["review", "fix", "custom"]).default("custom"),
    instructions: z.string().trim().max(12_000).optional().nullable(),
  })
  .strict();
const mergeGitHubPullRequestSchema = z
  .object({
    repository: githubRepositorySchema,
    pullNumber: z.number().int().positive(),
    mergeMethod: z.enum(["merge", "squash", "rebase"]).default("squash"),
    expectedHeadSha: z.string().trim().min(7).optional(),
    requireCleanChecks: z.boolean().optional().default(true),
    allowNoChecks: z.boolean().optional().default(false),
    commitTitle: z.string().trim().max(250).optional().nullable(),
    commitMessage: z.string().trim().max(10_000).optional().nullable(),
  })
  .strict();
const entityTypeSchema = z.enum([
  "users",
  "tickets",
  "versions",
  "features",
  "platform_versions",
  "changelog_entries",
  "characters",
  "wikis",
  "wiki_pages",
  "voices",
  "worlds",
  "world_sessions",
  "eval_suites",
  "eval_runs",
  "eval_sweeps",
]);
const patchableEntityTypeSchema = z.enum([
  "tickets",
  "versions",
  "features",
  "platform_versions",
  "changelog_entries",
  "characters",
  "wikis",
  "wiki_pages",
  "voices",
]);
const entityFilterSchema = z
  .object({
    field: z.string().trim().min(1),
    op: z.enum(["eq", "neq", "contains", "startsWith", "in"]).default("eq"),
    value: z.unknown().optional(),
    values: z.array(z.unknown()).max(50).optional(),
  })
  .strict();
const queryEntitiesSchema = z
  .object({
    entityType: entityTypeSchema,
    filters: z.array(entityFilterSchema).max(12).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
const getEntityDetailSchema = z
  .object({
    entityType: entityTypeSchema,
    id: z.string().trim().min(1),
  })
  .strict();
const searchEntitiesSchema = z
  .object({
    query: z.string().trim().min(2).max(500),
    entityTypes: z.array(entityTypeSchema).max(8).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();
const semanticSearchDomainSchema = z.enum([
  "wiki_pages",
  "characters",
  "sessions",
  "evals",
  "docs",
  "tickets",
  "changelog",
]);
const semanticSearchContextSchema = z
  .object({
    query: z.string().trim().min(2).max(1_000),
    domains: z.array(semanticSearchDomainSchema).max(7).optional(),
    characterId: optionalNonEmptyString,
    wikiId: optionalNonEmptyString,
    sessionIds: optionalStringArray(25, 160),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();
const traceEntityContextSchema = z
  .object({
    entityType: entityTypeSchema,
    id: z.string().trim().min(1),
    include: z
      .array(
        z.enum([
          "character",
          "wikis",
          "wikiPages",
          "sessions",
          "evals",
          "worlds",
          "worldGraph",
          "tickets",
          "features",
          "voices",
        ]),
      )
      .max(10)
      .optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();
const analyzeSessionsSchema = z
  .object({
    characterId: optionalNonEmptyString,
    sessionIds: optionalStringArray(25, 160),
    limit: optionalInt(1, 25),
    criteria: optionalStringArray(12, 240),
  })
  .strict();
const proposeEntityPatchSchema = z
  .object({
    entityType: patchableEntityTypeSchema,
    id: z.string().trim().min(1),
    patch: z.record(z.string(), z.unknown()),
    rationale: z.string().trim().min(1).max(4_000),
    evidence: z.array(z.string().trim().min(1).max(1_000)).max(20).optional(),
  })
  .strict();
const batchChildToolNameSchema = z.enum([
  "propose_entity_patch",
  "create_ticket",
  "update_ticket",
]);
const proposeOperationBatchSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
    rationale: z.string().trim().min(1).max(4_000),
    evidence: z.array(z.string().trim().min(1).max(1_000)).max(20).optional(),
    operations: z
      .array(
        z
          .object({
            toolName: batchChildToolNameSchema,
            intent: z.string().trim().max(500).optional().nullable(),
            args: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();

const jsonRecordSchema = z.record(z.string(), z.unknown());
const eraSchema = z
  .object({
    key: z.string().trim().min(1),
    title: z.string().trim().min(1),
    order: z.number().int(),
  })
  .strict();
const positionSchema = z.object({ x: z.number(), y: z.number() }).strict();
const wikiPageTypeSchema = z.enum([
  "entity",
  "event",
  "concept",
  "relationship",
  "timeline",
  "voice_identity",
]);
const sourceKindSchema = z.enum([
  "bible",
  "commentary",
  "midrash",
  "note",
  "transcript",
  "primary",
  "annotation",
  "reference",
]);
const ingestionStatusSchema = z.enum(["succeeded", "failed", "canceled"]);
const worldNodeKindSchema = z.enum(["character", "place", "event"]);
const voiceProviderSchema = z.enum([
  "pocket_tts",
  "elevenlabs",
  "openai",
  "cartesia",
]);
const voiceStatusSchema = z.enum(["uploaded", "processing", "ready", "failed"]);
const featuresListSchema = z
  .object({
    versionId: z.string().trim().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
const worldIdSchema = z.object({ worldId: z.string().trim().min(1) }).strict();
const characterLookupSchema = z
  .object({
    id: z.string().trim().optional(),
    slug: z.string().trim().optional(),
  })
  .strict();
const wikiDetailSchema = z
  .object({
    wikiId: z.string().trim().min(1),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
const voicesListSchema = z
  .object({
    includeArchived: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
const sessionDetailSchema = z
  .object({ sessionId: z.string().trim().min(1) })
  .strict();
const evalListSchema = z
  .object({
    characterId: z.string().trim().min(1),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
const updateUserRoleSchema = z
  .object({ id: z.string().trim().min(1), role: z.enum(["user", "admin"]) })
  .strict();
const createCharacterSchema = z
  .object({
    slug: z.string().trim().min(1),
    title: z.string().trim().min(1),
    summary: nullableString,
    image: nullableString,
    thumbnailColor: nullableString,
    eras: z.array(eraSchema).optional(),
    ingestionPrompt: nullableString,
    identity: z.unknown().optional(),
    voiceStyle: z.unknown().optional(),
    brainModel: z.unknown().optional(),
    directive: z.unknown().optional(),
  })
  .strict();
const updateCharacterSchema = createCharacterSchema
  .omit({ slug: true })
  .partial()
  .extend({
    id: z.string().trim().min(1),
    voiceId: nullableString,
    voiceSettings: z.unknown().optional().nullable(),
  })
  .strict();
const createWorldSchema = z
  .object({
    prompt: z.string().trim().min(1),
    status: z.enum(["published", "draft"]).optional(),
    definition: z.unknown(),
  })
  .strict();
const updateWorldSchema = z
  .object({
    worldId: z.string().trim().min(1),
    definition: z.unknown(),
  })
  .strict();
const createWikiSchema = z
  .object({
    slug: z.string().trim().min(1),
    title: z.string().trim().min(1),
    summary: nullableString,
    eras: z.array(eraSchema).optional(),
    ingestionPrompt: nullableString,
    ingestionPromptName: nullableString,
  })
  .strict();
const updateWikiSchema = createWikiSchema
  .partial()
  .omit({ slug: true })
  .extend({
    id: z.string().trim().min(1),
  })
  .strict();
const createWikiBindingSchema = z
  .object({
    characterId: z.string().trim().min(1),
    wikiId: z.string().trim().min(1),
    priority: z.enum(["primary", "secondary", "reference"]).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
const updateWikiBindingSchema = z
  .object({
    id: z.string().trim().min(1),
    priority: z.enum(["primary", "secondary", "reference"]).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
const saveWikiPageSchema = z
  .object({
    characterId: nullableString,
    wikiId: nullableString,
    type: wikiPageTypeSchema,
    slug: z.string().trim().min(1),
    title: z.string().trim().min(1),
    summary: nullableString,
    body: z.string().optional(),
    frontmatter: z.unknown().optional(),
    perspective: z.unknown().optional(),
    confidence: z.number().min(0).max(1).optional(),
    timeIndex: z.unknown().optional().nullable(),
    knowsFuture: z.boolean().optional(),
    contradictions: z.array(z.unknown()).optional(),
    note: nullableString,
  })
  .strict();
const sourceTypeSchema = z.enum(["primary", "secondary", "tertiary"]);
const createWikiSourceSchema = z
  .object({
    characterId: nullableString,
    wikiId: nullableString,
    title: z.string().trim().min(1),
    // `kind` is the deprecated legacy classifier; `sourceType` is the tier.
    kind: sourceKindSchema.optional(),
    sourceType: sourceTypeSchema.optional(),
    content: z.string().min(1),
    metadata: jsonRecordSchema.optional(),
  })
  .strict();
const startIngestionSchema = z
  .object({
    characterId: nullableString,
    wikiId: nullableString,
    sourceId: nullableString,
    model: nullableString,
    promptHash: nullableString,
    notes: nullableString,
    status: z.enum(["queued", "running"]).optional(),
  })
  .strict();
const finishIngestionSchema = z
  .object({
    id: z.string().trim().min(1),
    status: ingestionStatusSchema,
    pagesCreated: z.number().int().min(0).optional(),
    pagesUpdated: z.number().int().min(0).optional(),
    edgesAdded: z.number().int().min(0).optional(),
    contradictionsFound: z.number().int().min(0).optional(),
    tokensUsed: z.number().int().min(0).optional(),
    errorMessage: nullableString,
  })
  .strict();
const createVoiceSchema = z
  .object({
    slug: z.string().trim().min(1),
    name: z.string().trim().min(1),
    description: nullableString,
    provider: voiceProviderSchema.optional(),
    providerConfig: jsonRecordSchema.optional(),
    sourcePath: nullableString,
    durationS: z.number().nonnegative().optional().nullable(),
    sampleRate: z.number().int().positive().optional().nullable(),
    tags: z.array(z.string().trim().min(1)).optional(),
    language: nullableString,
    gender: nullableString,
    license: nullableString,
    attribution: nullableString,
    status: voiceStatusSchema.optional(),
  })
  .strict();
const updateVoiceSchema = createVoiceSchema
  .omit({ slug: true })
  .partial()
  .extend({
    id: z.string().trim().min(1),
    statusError: nullableString,
    embeddingPath: nullableString,
    previewPath: nullableString,
    archivedAt: nullableString,
  })
  .strict();
const voicePreviewSchema = z
  .object({
    voiceId: z.string().trim().min(1),
    label: z.string().trim().min(1),
    path: z.string().trim().min(1),
    prompt: nullableString,
    durationS: z.number().nonnegative().optional().nullable(),
    sampleRate: z.number().int().positive().optional().nullable(),
  })
  .strict();
const finishVoiceAttemptSchema = z
  .object({
    attemptId: z.string().trim().min(1),
    status: z.enum(["succeeded", "failed"]),
    error: nullableString,
  })
  .strict();
const createWorldNodeSchema = z
  .object({
    worldId: z.string().trim().min(1),
    kind: worldNodeKindSchema,
    refId: nullableString,
    label: z.string().trim().min(1),
    summary: nullableString,
    data: jsonRecordSchema.optional(),
    position: positionSchema.optional().nullable(),
  })
  .strict();
const updateWorldNodeSchema = z
  .object({
    id: z.string().trim().min(1),
    label: z.string().trim().min(1).optional(),
    summary: nullableString,
    data: jsonRecordSchema.optional(),
    position: positionSchema.optional().nullable(),
  })
  .strict();
const ingestCharacterNodeSchema = z
  .object({
    worldId: z.string().trim().min(1),
    characterId: z.string().trim().min(1),
    label: z.string().trim().min(1).optional(),
    roleInWorld: z.string().trim().min(1).optional(),
    data: jsonRecordSchema.optional(),
    position: positionSchema.optional(),
    mergeOnExist: z.boolean().optional(),
  })
  .strict();
const createWorldEdgeSchema = z
  .object({
    worldId: z.string().trim().min(1),
    fromNodeId: z.string().trim().min(1),
    toNodeId: z.string().trim().min(1),
    kind: z.string().trim().min(1),
    data: jsonRecordSchema.optional(),
  })
  .strict();
const createWorldSessionSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    userId: nullableString,
    worldId: nullableString,
    characterId: nullableString,
    mode: z.string().trim().min(1),
    status: z.string().trim().min(1).optional(),
    initialMoment: z.unknown().optional(),
    initialScene: z.unknown().optional(),
    currentMoment: z.unknown().optional(),
    currentScene: z.unknown().optional(),
    metadata: jsonRecordSchema.optional(),
  })
  .strict();
const endWorldSessionSchema = z
  .object({
    id: z.string().trim().min(1),
    status: z.string().trim().min(1).optional(),
    metadata: jsonRecordSchema.optional(),
  })
  .strict();
const updateWorldSessionSceneSchema = z
  .object({
    sessionId: z.string().trim().min(1),
    currentScene: z.unknown(),
  })
  .strict();
const appendWorldSessionEventSchema = z
  .object({
    sessionId: z.string().trim().min(1),
    turnId: nullableString,
    type: z.string().trim().min(1),
    source: z.string().trim().min(1),
    payload: z.unknown().optional(),
  })
  .strict();
const createEvalSuiteSchema = z
  .object({
    characterId: z.string().trim().min(1),
    slug: z.string().trim().min(1),
    version: z.string().trim().min(1),
    probes: z.array(z.unknown()),
    notes: nullableString,
  })
  .strict();
const forkEvalDraftSchema = z
  .object({
    sourceId: z.string().trim().min(1),
    version: z.string().trim().min(1).optional(),
  })
  .strict();
const updateEvalDraftSchema = z
  .object({
    suiteId: z.string().trim().min(1),
    probes: z.array(z.unknown()).optional(),
    releaseNotes: nullableString,
  })
  .strict();
const publishEvalDraftSchema = z
  .object({
    suiteId: z.string().trim().min(1),
    version: z.string().trim().min(1).optional(),
  })
  .strict();
const markEvalRunRunningSchema = z
  .object({
    runId: z.string().trim().min(1),
    total: z.number().int().min(0),
  })
  .strict();
const markEvalRunErroredSchema = z
  .object({
    runId: z.string().trim().min(1),
    errorMessage: z.string().trim().min(1),
  })
  .strict();
const createPendingSweepSchema = z
  .object({
    characterId: z.string().trim().min(1),
    suiteId: z.string().trim().min(1),
    judgeModel: z.string().trim().min(1),
    spec: z.unknown(),
    probeIds: z.array(z.string().trim().min(1)).optional().nullable(),
    maxConcurrency: z.number().int().positive().optional().nullable(),
    configs: z.array(z.unknown()),
  })
  .strict();
const markSweepErroredSchema = z
  .object({
    sweepId: z.string().trim().min(1),
    errorMessage: z.string().trim().min(1),
  })
  .strict();

function compact<T>(value: T, maxChars = 8_000): T | string {
  const text = JSON.stringify(value);
  if (text.length <= maxChars) return value;
  return `${text.slice(0, maxChars)}...`;
}

function summaryForList(label: string, items: unknown[]) {
  return `${label}: ${items.length} record${items.length === 1 ? "" : "s"}.`;
}

function requireDb() {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is not configured.");
  return db;
}

function validate<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  args: unknown,
): z.infer<TSchema> {
  return schema.parse(args ?? {});
}

async function getUserById(id: string) {
  const [row] = await requireDb()
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      image: usersTable.image,
      createdAt: usersTable.createdAt,
      updatedAt: usersTable.updatedAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  return row
    ? {
        ...row,
        createdAt:
          row.createdAt instanceof Date
            ? row.createdAt.toISOString()
            : String(row.createdAt),
        updatedAt:
          row.updatedAt instanceof Date
            ? row.updatedAt.toISOString()
            : String(row.updatedAt),
      }
    : null;
}

const readTools: AdminAgentReadTool[] = [
  {
    kind: "read",
    name: "list_project_files",
    description:
      "List readable source/documentation files in the deployed Odyssey repo root. Secrets, env files, dependencies, build outputs, and binary assets are excluded.",
    inputSchema: listProjectFilesSchema,
    async run(rawArgs) {
      const args = validate(listProjectFilesSchema, rawArgs);
      const result = await listProjectFiles(args);
      return {
        summary: `Readable project files: ${result.count}${result.truncated ? " shown; more available with narrower globs" : ""}.`,
        data: result,
      };
    },
  },
  {
    kind: "read",
    name: "search_code",
    description:
      "Search readable source/documentation files in the Odyssey repo for a literal string. Use this before answering codebase or architecture questions.",
    inputSchema: searchCodeSchema,
    async run(rawArgs) {
      const args = validate(searchCodeSchema, rawArgs);
      const result = await searchCode(args);
      return {
        summary: `Code search "${result.query}": ${result.matches.length} match${result.matches.length === 1 ? "" : "es"} across ${result.scannedFiles} scanned files.`,
        data: result,
      };
    },
  },
  {
    kind: "read",
    name: "read_source_file",
    description:
      "Read a specific readable source/documentation file by repo-relative path. Secrets, env files, dependencies, build outputs, and binary assets are excluded.",
    inputSchema: readSourceFileSchema,
    async run(rawArgs) {
      const { path, maxChars } = validate(readSourceFileSchema, rawArgs);
      const result = await readSourceFile({ filePath: path, maxChars });
      return {
        summary: `${result.path}: ${result.size} bytes${result.truncated ? ", truncated" : ""}.`,
        data: result,
      };
    },
  },
  {
    kind: "read",
    name: "inspect_route_source",
    description:
      "Find and read admin app page/layout/API source files that correspond to a pathname.",
    inputSchema: inspectRouteSourceSchema,
    async run(rawArgs, context) {
      const parsed = validate(inspectRouteSourceSchema, rawArgs);
      const result = await inspectRouteSource({
        pathname: parsed.pathname || context.routeContext?.pathname || "/",
        maxCharsPerFile: parsed.maxCharsPerFile,
      });
      return {
        summary: `Route ${result.pathname}: ${result.count} matching source file${result.count === 1 ? "" : "s"}.`,
        data: result,
      };
    },
  },
  {
    kind: "read",
    name: "get_github_issue",
    description:
      "Read a configured GitHub issue so the admin agent can understand a Codex Web task thread.",
    inputSchema: getGitHubIssueSchema,
    async run(rawArgs) {
      const args = validate(getGitHubIssueSchema, rawArgs);
      const { repository, issue } = await getGitHubIssue(args);
      return {
        summary: `GitHub issue ${repository.fullName}#${issue.number}: ${issue.title} (${issue.state}).`,
        data: {
          repository: repository.fullName,
          issue: {
            number: issue.number,
            title: issue.title,
            state: issue.state,
            url: issue.html_url,
            labels: issue.labels,
          },
        },
      };
    },
  },
  {
    kind: "read",
    name: "get_github_pull_request_status",
    description:
      "Read PR merge readiness, head SHA, draft state, commit statuses, and check-run summary for an allowlisted GitHub repository.",
    inputSchema: getGitHubPullRequestStatusSchema,
    async run(rawArgs) {
      const args = validate(getGitHubPullRequestStatusSchema, rawArgs);
      const readiness = await getGitHubPullRequestReadiness({
        ...args,
        requireCleanChecks: true,
        allowNoChecks: false,
      });
      return {
        summary: `PR ${readiness.repository}#${readiness.pullRequest.number}: ${readiness.isMergeableByPolicy ? "ready by policy" : "blocked"}.`,
        data: readiness,
      };
    },
  },
  {
    kind: "read",
    name: "query_entities",
    description:
      "Query an allowlisted entity type with safe filters. This is the general-purpose DB read tool; no raw SQL or secret fields are exposed.",
    inputSchema: queryEntitiesSchema,
    async run(rawArgs) {
      const args = validate(queryEntitiesSchema, rawArgs);
      const rows = applyEntityFilters(
        await listEntityRecords(
          args.entityType,
          args.filters ?? [],
          args.limit ?? 50,
        ),
        args.filters ?? [],
      ).slice(0, args.limit ?? 50);
      return {
        summary: `${args.entityType}: ${rows.length} record${rows.length === 1 ? "" : "s"} returned.`,
        data: {
          entityType: args.entityType,
          count: rows.length,
          records: rows.map(compactEntityRecord),
        },
      };
    },
  },
  {
    kind: "read",
    name: "get_entity_detail",
    description:
      "Fetch one allowlisted entity by id using typed store APIs where available.",
    inputSchema: getEntityDetailSchema,
    async run(rawArgs) {
      const args = validate(getEntityDetailSchema, rawArgs);
      const record = await getEntityRecord(args.entityType, args.id);
      return {
        summary: record
          ? `${args.entityType} ${args.id} loaded.`
          : `${args.entityType} ${args.id} not found.`,
        data: compact(record),
      };
    },
  },
  {
    kind: "read",
    name: "search_entities",
    description:
      "Search text fields across allowlisted admin entities. Useful when the admin does not know exact ids.",
    inputSchema: searchEntitiesSchema,
    async run(rawArgs) {
      const args = validate(searchEntitiesSchema, rawArgs);
      const entityTypes = args.entityTypes?.length
        ? args.entityTypes
        : ([
            "tickets",
            "characters",
            "wikis",
            "wiki_pages",
            "voices",
            "world_sessions",
            "changelog_entries",
          ] satisfies Array<z.infer<typeof entityTypeSchema>>);
      const perTypeLimit = Math.max(
        5,
        Math.ceil((args.limit ?? 25) / entityTypes.length),
      );
      const groups = await Promise.all(
        entityTypes.map(async (entityType) => ({
          entityType,
          records: searchRecords(
            await listEntityRecords(entityType, [], 100),
            args.query,
          ).slice(0, perTypeLimit),
        })),
      );
      const matches = groups
        .flatMap((group) =>
          group.records.map((record) => ({
            entityType: group.entityType,
            record: compactEntityRecord(record),
          })),
        )
        .slice(0, args.limit ?? 25);
      return {
        summary: `Search "${args.query}": ${matches.length} match${matches.length === 1 ? "" : "es"}.`,
        data: { query: args.query, matches },
      };
    },
  },
  {
    kind: "read",
    name: "semantic_search_context",
    description:
      "Rank relevant context snippets across wikis, characters, sessions, evals, docs, tickets, and changelog. Uses safe lexical ranking now; wiki pgvector ranking can be added later.",
    inputSchema: semanticSearchContextSchema,
    async run(rawArgs) {
      const args = validate(semanticSearchContextSchema, rawArgs);
      const result = await semanticSearchContext(args);
      return {
        summary: `Semantic context search "${args.query}": ${result.matches.length} ranked match${result.matches.length === 1 ? "" : "es"}.`,
        data: result,
      };
    },
  },
  {
    kind: "read",
    name: "trace_entity_context",
    description:
      "Trace related admin context around a character, wiki, session, ticket, world, voice, or roadmap entity.",
    inputSchema: traceEntityContextSchema,
    async run(rawArgs) {
      const args = validate(traceEntityContextSchema, rawArgs);
      const trace = await traceEntityContext(args);
      return {
        summary: `${args.entityType} ${args.id}: traced ${Object.keys(trace.related).length} related context group${Object.keys(trace.related).length === 1 ? "" : "s"}.`,
        data: trace,
      };
    },
  },
  {
    kind: "read",
    name: "analyze_sessions",
    description:
      "Analyze recent or selected world sessions for behavioral evidence, grounding signals, errors, and improvement targets.",
    inputSchema: analyzeSessionsSchema,
    async run(rawArgs, context) {
      const args = await resolveAnalyzeSessionArgs(
        validate(analyzeSessionsSchema, rawArgs),
        context,
      );
      const analysis = await analyzeWorldSessions(args);
      return {
        summary: `Analyzed ${analysis.sessionCount} session${analysis.sessionCount === 1 ? "" : "s"} with ${analysis.turnCount} turn${analysis.turnCount === 1 ? "" : "s"}.`,
        data: analysis,
      };
    },
  },
  {
    kind: "read",
    name: "list_users",
    description: "List admin-app users without password hashes or auth tokens.",
    inputSchema: limitSchema,
    async run(rawArgs) {
      const { limit = 50 } = validate(limitSchema, rawArgs);
      const rows = await requireDb()
        .select({
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
          role: usersTable.role,
          image: usersTable.image,
          createdAt: usersTable.createdAt,
          updatedAt: usersTable.updatedAt,
        })
        .from(usersTable)
        .limit(limit);
      const users = rows.map((row) => ({
        ...row,
        createdAt:
          row.createdAt instanceof Date
            ? row.createdAt.toISOString()
            : String(row.createdAt),
        updatedAt:
          row.updatedAt instanceof Date
            ? row.updatedAt.toISOString()
            : String(row.updatedAt),
      }));
      return { summary: summaryForList("Users", users), data: users };
    },
  },
  {
    kind: "read",
    name: "list_tickets",
    description: "List roadmap/kanban tickets.",
    inputSchema: limitSchema,
    async run(rawArgs) {
      const { limit = 50 } = validate(limitSchema, rawArgs);
      const tickets = (await getTicketStore().list()).slice(0, limit);
      return { summary: summaryForList("Tickets", tickets), data: tickets };
    },
  },
  {
    kind: "read",
    name: "list_versions",
    description: "List roadmap versions.",
    inputSchema: emptySchema,
    async run() {
      const versions = await getVersionStore().list();
      return { summary: summaryForList("Versions", versions), data: versions };
    },
  },
  {
    kind: "read",
    name: "list_features",
    description: "List roadmap features, optionally filtered by versionId.",
    inputSchema: featuresListSchema,
    async run(rawArgs) {
      const { versionId, limit = 100 } = validate(featuresListSchema, rawArgs);
      const features = (await getFeatureStore().list(versionId)).slice(
        0,
        limit,
      );
      return { summary: summaryForList("Features", features), data: features };
    },
  },
  {
    kind: "read",
    name: "list_changelog",
    description: "List recent changelog entries.",
    inputSchema: limitSchema,
    async run(rawArgs) {
      const { limit = 20 } = validate(limitSchema, rawArgs);
      const entries = (await getChangelogStore().list()).slice(0, limit);
      return {
        summary: summaryForList("Changelog entries", entries),
        data: entries,
      };
    },
  },
  {
    kind: "read",
    name: "list_platform_versions",
    description: "List product release/platform versions.",
    inputSchema: emptySchema,
    async run() {
      const versions = await getPlatformVersionStore().list();
      return {
        summary: summaryForList("Platform versions", versions),
        data: versions,
      };
    },
  },
  {
    kind: "read",
    name: "list_characters",
    description: "List characters.",
    inputSchema: limitSchema,
    async run(rawArgs) {
      const { limit = 60 } = validate(limitSchema, rawArgs);
      const characters = (await getCharacterStore().list())
        .slice(0, limit)
        .map((c) => ({
          id: c.id,
          slug: c.slug,
          title: c.title,
          summary: c.summary,
          voiceId: c.voiceId,
          hasIdentity: Boolean(c.identity),
          hasDirective: Boolean(c.directive),
          hasVoiceStyle: Boolean(c.voiceStyle),
          hasBrainModel: Boolean(c.brainModel),
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        }));
      return {
        summary: summaryForList("Characters", characters),
        data: characters,
      };
    },
  },
  {
    kind: "read",
    name: "get_character",
    description: "Get a character by id or slug.",
    inputSchema: characterLookupSchema,
    async run(rawArgs) {
      const { id, slug } = validate(characterLookupSchema, rawArgs);
      if (!id && !slug) throw new Error("id or slug is required.");
      const character = id
        ? await getCharacterStore().getById(id)
        : await getCharacterStore().getBySlug(slug!);
      return {
        summary: character
          ? `Character ${character.title} loaded.`
          : "Character not found.",
        data: compact(character),
      };
    },
  },
  {
    kind: "read",
    name: "list_wikis",
    description: "List top-level wikis with counts.",
    inputSchema: limitSchema,
    async run(rawArgs) {
      const { limit = 50 } = validate(limitSchema, rawArgs);
      const wikis = (await getWikisStore().listWikiSummaries()).slice(0, limit);
      return { summary: summaryForList("Wikis", wikis), data: wikis };
    },
  },
  {
    kind: "read",
    name: "get_wiki_detail",
    description:
      "Get wiki metadata, pages, sources, bindings, and recent ingestion runs.",
    inputSchema: wikiDetailSchema,
    async run(rawArgs) {
      const { wikiId, limit = 30 } = validate(wikiDetailSchema, rawArgs);
      const store = getWikisStore();
      const [wiki, pages, sources, ingestions, bindings] = await Promise.all([
        store.getWikiById(wikiId),
        store.listPagesForWiki(wikiId),
        store.listSourcesForWiki(wikiId),
        store.listIngestionsForWiki(wikiId, limit),
        store.listBindingsForWiki(wikiId),
      ]);
      return {
        summary: wiki
          ? `Wiki ${wiki.title} loaded.`
          : `Wiki ${wikiId} not found.`,
        data: {
          wiki,
          pages: pages.slice(0, limit),
          sources: sources.slice(0, limit),
          ingestions,
          bindings,
        },
      };
    },
  },
  {
    kind: "read",
    name: "list_voices",
    description: "List voices and binding summaries.",
    inputSchema: voicesListSchema,
    async run(rawArgs) {
      const { includeArchived = false, limit = 60 } = validate(
        voicesListSchema,
        rawArgs,
      );
      const voices = (await getVoiceStore().list({ includeArchived })).slice(
        0,
        limit,
      );
      return { summary: summaryForList("Voices", voices), data: voices };
    },
  },
  {
    kind: "read",
    name: "list_sessions",
    description: "List scene session summaries.",
    inputSchema: limitSchema,
    async run(rawArgs) {
      const { limit = 50 } = validate(limitSchema, rawArgs);
      const sessions = await getSceneSessionStore().listSessionSummaries(limit);
      return {
        summary: summaryForList("Scene sessions", sessions),
        data: sessions,
      };
    },
  },
  {
    kind: "read",
    name: "get_session_detail",
    description: "Get full scene session detail.",
    inputSchema: sessionDetailSchema,
    async run(rawArgs) {
      const { sessionId } = validate(sessionDetailSchema, rawArgs);
      const detail = await getSceneSessionStore().getSessionDetail(sessionId);
      return {
        summary: detail
          ? `Session ${sessionId} loaded.`
          : `Session ${sessionId} not found.`,
        data: compact(detail),
      };
    },
  },
  {
    kind: "read",
    name: "list_evals",
    description: "List eval suites, recent runs, and sweeps for a character.",
    inputSchema: evalListSchema,
    async run(rawArgs) {
      const { characterId, limit = 20 } = validate(evalListSchema, rawArgs);
      const store = getEvalStore();
      const [suites, runs, sweeps] = await Promise.all([
        store.listSuites(characterId),
        store.listRuns({ characterId, limit }),
        store.listSweeps(characterId),
      ]);
      return {
        summary: `Eval data for ${characterId}: ${suites.length} suites, ${runs.length} runs, ${sweeps.length} sweeps.`,
        data: { suites, runs, sweeps },
      };
    },
  },
];

const createTicketSchema = z
  .object({
    title: z.string().trim().min(1),
    description: nullableString,
    status: z.string().trim().min(1).default("backlog"),
    domain: nullableString,
    priority: nullableString,
    assignee: nullableString,
    phase: nullableString,
    featureId: nullableString,
    startDate: nullableString,
    endDate: nullableString,
  })
  .strict();

const updateTicketSchema = createTicketSchema
  .partial()
  .extend({ id: z.string().trim().min(1) })
  .strict();

const mutationTools = [
  {
    kind: "mutation",
    name: "propose_operation_batch",
    description:
      "Propose a conservative multi-step improvement plan as one approval. Supports entity patches and ticket create/update operations only.",
    inputSchema: proposeOperationBatchSchema,
    async dryRun(rawArgs, context): Promise<AdminAgentDryRunResult> {
      const args = validate(proposeOperationBatchSchema, rawArgs);
      const children = await dryRunBatchChildren(args.operations, context);
      return {
        intent: `Approve improvement plan: ${args.title}`,
        riskLevel: maxRisk(children.map((child) => child.preview.riskLevel)),
        affectedRecords: children.flatMap(
          (child) => child.preview.affectedRecords ?? [],
        ),
        previewDiff: {
          kind: "operation_batch",
          title: args.title,
          rationale: args.rationale,
          evidence: args.evidence ?? [],
          operations: children.map((child, index) => ({
            index: index + 1,
            toolName: child.toolName,
            intent: child.intent,
            riskLevel: child.preview.riskLevel,
            affectedRecords: child.preview.affectedRecords,
            previewDiff: child.preview.previewDiff,
            resultSummary: child.preview.resultSummary,
          })),
        },
        beforeSnapshot: children.map((child) => ({
          toolName: child.toolName,
          args: child.args,
          beforeSnapshot: child.preview.beforeSnapshot ?? null,
        })),
        resultSummary: {
          action: "operation_batch",
          title: args.title,
          operationCount: children.length,
          tools: children.map((child) => child.toolName),
        },
      };
    },
    async execute(
      rawArgs,
      operation,
      context,
    ): Promise<AdminAgentExecutionResult> {
      const args = validate(proposeOperationBatchSchema, rawArgs);
      const results: Array<{
        index: number;
        toolName: string;
        intent: string;
        resultSummary: unknown;
      }> = [];

      for (let i = 0; i < args.operations.length; i++) {
        const child = args.operations[i];
        const preview = await dryRunMutationTool(
          child.toolName,
          child.args,
          context,
        );
        const childOperation: AdminAgentOperationRecord = {
          ...operation,
          id: `${operation.id}:${i + 1}`,
          toolName: child.toolName,
          intent: child.intent?.trim() || preview.intent,
          riskLevel: preview.riskLevel,
          args: child.args,
          affectedRecords: preview.affectedRecords,
          previewDiff: preview.previewDiff,
          beforeSnapshot: preview.beforeSnapshot ?? null,
          resultSummary: preview.resultSummary ?? {},
        };
        const result = await executeMutationTool(
          child.toolName,
          child.args,
          childOperation,
          context,
        );
        results.push({
          index: i + 1,
          toolName: child.toolName,
          intent: childOperation.intent,
          resultSummary: result.resultSummary,
        });
      }

      return {
        afterSnapshot: results,
        resultSummary: {
          action: "operation_batch_completed",
          title: args.title,
          completedCount: results.length,
          results,
        },
      };
    },
  },
  {
    kind: "mutation",
    name: "propose_entity_patch",
    description:
      "Patch allowlisted fields on a supported entity after admin approval. Use this for dynamic improvements to tickets, roadmap records, characters, wikis, wiki pages, voices, and changelog entries.",
    inputSchema: proposeEntityPatchSchema,
    async dryRun(rawArgs): Promise<AdminAgentDryRunResult> {
      const args = validate(proposeEntityPatchSchema, rawArgs);
      const existing = await getEntityRecord(args.entityType, args.id);
      if (!existing)
        throw new Error(`${args.entityType} ${args.id} not found.`);
      const patch = validateEntityPatch(args.entityType, args.patch);
      return {
        intent: `Patch ${args.entityType} ${args.id}`,
        riskLevel: riskForEntityPatch(args.entityType, patch),
        affectedRecords: [
          {
            table: args.entityType,
            id: args.id,
            label: entityLabel(existing),
          },
        ],
        previewDiff: {
          before: existing,
          patch,
          afterPreview: { ...(existing as Record<string, unknown>), ...patch },
          rationale: args.rationale,
          evidence: args.evidence ?? [],
        },
        beforeSnapshot: existing,
        resultSummary: {
          action: "patch",
          entityType: args.entityType,
          id: args.id,
          fields: Object.keys(patch),
        },
      };
    },
    async execute(
      rawArgs,
      operation,
      context,
    ): Promise<AdminAgentExecutionResult> {
      const args = validate(proposeEntityPatchSchema, rawArgs);
      const patch = validateEntityPatch(args.entityType, args.patch);
      await assertPatchTargetNotStale(
        args.entityType,
        args.id,
        operation.beforeSnapshot,
      );
      const updated = await executeEntityPatch(
        args.entityType,
        args.id,
        patch,
        {
          rationale: args.rationale,
          adminUserId: context.adminUser.id,
        },
      );
      return {
        afterSnapshot: updated,
        resultSummary: {
          action: "patched",
          entityType: args.entityType,
          id: args.id,
          fields: Object.keys(patch),
        },
      };
    },
  },
  {
    kind: "mutation",
    name: "create_codex_code_task",
    description:
      "Create a GitHub issue for a code change and optionally start Codex Web by commenting @codex. Requires approval.",
    inputSchema: createCodexCodeTaskSchema,
    async dryRun(rawArgs): Promise<AdminAgentDryRunResult> {
      const args = validate(createCodexCodeTaskSchema, rawArgs);
      const repository = resolveGitHubRepository(args.repository);
      const issueBody = buildCodexIssueBody(args);
      const codexComment = args.startCodex
        ? buildCodexIssueComment(args)
        : null;
      return {
        intent: `Create Codex Web code task "${args.title}"`,
        riskLevel: "high",
        affectedRecords: [
          {
            table: "github_issues",
            id: `${repository.fullName}:new`,
            label: args.title,
          },
        ],
        previewDiff: {
          externalSideEffect: "github_issue",
          repository: repository.fullName,
          createIssue: {
            title: args.title,
            labels: args.labels ?? [],
            bodyPreview: truncate(issueBody, 2_000),
          },
          codexCommentPreview: codexComment
            ? truncate(codexComment, 2_000)
            : null,
        },
        resultSummary: {
          action: "create_codex_code_task",
          repository: repository.fullName,
          title: args.title,
          willStartCodex: args.startCodex,
        },
      };
    },
    async execute(rawArgs): Promise<AdminAgentExecutionResult> {
      const args = validate(createCodexCodeTaskSchema, rawArgs);
      const issueBody = buildCodexIssueBody(args);
      const { repository, issue } = await createGitHubIssue({
        repository: args.repository,
        title: args.title,
        body: issueBody,
        labels: args.labels,
      });
      const comment = args.startCodex
        ? await createGitHubIssueComment({
            repository: repository.fullName,
            issueNumber: issue.number,
            body: buildCodexIssueComment(args),
          })
        : null;
      return {
        afterSnapshot: {
          repository: repository.fullName,
          issue,
          codexComment: comment?.comment ?? null,
        },
        resultSummary: {
          repository: repository.fullName,
          issueNumber: issue.number,
          issueUrl: issue.html_url,
          codexCommentUrl: comment?.comment.html_url ?? null,
        },
      };
    },
  },
  {
    kind: "mutation",
    name: "request_codex_on_issue",
    description:
      "Comment @codex instructions on an existing GitHub issue. Requires approval.",
    inputSchema: requestCodexOnIssueSchema,
    async dryRun(rawArgs): Promise<AdminAgentDryRunResult> {
      const args = validate(requestCodexOnIssueSchema, rawArgs);
      const repository = resolveGitHubRepository(args.repository);
      const body = buildCodexIssueFollowup(args.instructions);
      return {
        intent: `Request Codex Web on issue ${repository.fullName}#${args.issueNumber}`,
        riskLevel: "high",
        affectedRecords: [
          {
            table: "github_issues",
            id: `${repository.fullName}#${args.issueNumber}`,
            label: "Codex Web request",
          },
        ],
        previewDiff: {
          externalSideEffect: "github_issue_comment",
          repository: repository.fullName,
          issueNumber: args.issueNumber,
          commentPreview: truncate(body, 2_000),
        },
        resultSummary: {
          action: "request_codex_on_issue",
          repository: repository.fullName,
          issueNumber: args.issueNumber,
        },
      };
    },
    async execute(rawArgs): Promise<AdminAgentExecutionResult> {
      const args = validate(requestCodexOnIssueSchema, rawArgs);
      const { repository, comment } = await createGitHubIssueComment({
        repository: args.repository,
        issueNumber: args.issueNumber,
        body: buildCodexIssueFollowup(args.instructions),
      });
      return {
        afterSnapshot: { repository: repository.fullName, comment },
        resultSummary: {
          repository: repository.fullName,
          issueNumber: args.issueNumber,
          commentUrl: comment.html_url,
        },
      };
    },
  },
  {
    kind: "mutation",
    name: "request_codex_on_pull_request",
    description:
      "Comment @codex review/fix/custom instructions on an existing GitHub pull request. Requires approval.",
    inputSchema: requestCodexOnPullRequestSchema,
    async dryRun(rawArgs): Promise<AdminAgentDryRunResult> {
      const args = validate(requestCodexOnPullRequestSchema, rawArgs);
      const repository = resolveGitHubRepository(args.repository);
      const body = buildCodexPullRequestComment(args);
      return {
        intent: `Request Codex Web on PR ${repository.fullName}#${args.pullNumber}`,
        riskLevel: args.mode === "review" ? "medium" : "high",
        affectedRecords: [
          {
            table: "github_pull_requests",
            id: `${repository.fullName}#${args.pullNumber}`,
            label: `Codex ${args.mode}`,
          },
        ],
        previewDiff: {
          externalSideEffect: "github_pr_comment",
          repository: repository.fullName,
          pullNumber: args.pullNumber,
          mode: args.mode,
          commentPreview: truncate(body, 2_000),
        },
        resultSummary: {
          action: "request_codex_on_pull_request",
          repository: repository.fullName,
          pullNumber: args.pullNumber,
          mode: args.mode,
        },
      };
    },
    async execute(rawArgs): Promise<AdminAgentExecutionResult> {
      const args = validate(requestCodexOnPullRequestSchema, rawArgs);
      const { repository, comment } = await createGitHubIssueComment({
        repository: args.repository,
        issueNumber: args.pullNumber,
        body: buildCodexPullRequestComment(args),
      });
      return {
        afterSnapshot: { repository: repository.fullName, comment },
        resultSummary: {
          repository: repository.fullName,
          pullNumber: args.pullNumber,
          commentUrl: comment.html_url,
          mode: args.mode,
        },
      };
    },
  },
  {
    kind: "mutation",
    name: "merge_github_pull_request",
    description:
      "Merge an allowlisted GitHub pull request after rechecking open/draft/head/check status. Requires approval.",
    inputSchema: mergeGitHubPullRequestSchema,
    async dryRun(rawArgs): Promise<AdminAgentDryRunResult> {
      const args = validate(mergeGitHubPullRequestSchema, rawArgs);
      const repository = resolveGitHubRepository(args.repository);
      return {
        intent: `Merge PR ${repository.fullName}#${args.pullNumber}`,
        riskLevel: "destructive",
        affectedRecords: [
          {
            table: "github_pull_requests",
            id: `${repository.fullName}#${args.pullNumber}`,
            label: `PR #${args.pullNumber}`,
          },
        ],
        previewDiff: {
          externalSideEffect: "github_pull_request_merge",
          repository: repository.fullName,
          pullNumber: args.pullNumber,
          mergeMethod: args.mergeMethod,
          expectedHeadSha: args.expectedHeadSha ?? null,
          executionChecks: {
            open: true,
            notDraft: true,
            mergeable: true,
            cleanChecksRequired: args.requireCleanChecks,
            allowNoChecks: args.allowNoChecks,
          },
        },
        resultSummary: {
          action: "merge_github_pull_request",
          repository: repository.fullName,
          pullNumber: args.pullNumber,
          mergeMethod: args.mergeMethod,
        },
      };
    },
    async execute(rawArgs): Promise<AdminAgentExecutionResult> {
      const args = validate(mergeGitHubPullRequestSchema, rawArgs);
      const readiness = await getGitHubPullRequestReadiness(args);
      if (!readiness.isMergeableByPolicy) {
        throw new Error(
          `PR is not mergeable by admin-agent policy: ${readiness.blockers.join(" ")}`,
        );
      }
      const result = await mergeGitHubPullRequest({
        repository: readiness.repository,
        pullNumber: args.pullNumber,
        mergeMethod: args.mergeMethod,
        expectedHeadSha: args.expectedHeadSha ?? readiness.pullRequest.head.sha,
        commitTitle: args.commitTitle ?? undefined,
        commitMessage: args.commitMessage ?? undefined,
      });
      return {
        afterSnapshot: { readiness, merge: result },
        resultSummary: {
          repository: readiness.repository,
          pullNumber: args.pullNumber,
          merged: result.merged,
          mergeSha: result.sha,
          message: result.message,
        },
      };
    },
  },
  {
    kind: "mutation",
    name: "create_ticket",
    description: "Create a kanban ticket. Requires approval.",
    inputSchema: createTicketSchema,
    async dryRun(rawArgs): Promise<AdminAgentDryRunResult> {
      const args = validate(createTicketSchema, rawArgs);
      return {
        intent: `Create ticket "${args.title}"`,
        riskLevel: "low",
        affectedRecords: [],
        previewDiff: { create: { table: "tickets", values: args } },
        resultSummary: {
          action: "create",
          table: "tickets",
          title: args.title,
        },
      };
    },
    async execute(rawArgs): Promise<AdminAgentExecutionResult> {
      const args = validate(createTicketSchema, rawArgs);
      const ticket = await getTicketStore().create({
        title: args.title,
        description: args.description ?? undefined,
        status: args.status,
        domain: args.domain ?? undefined,
        priority: args.priority ?? undefined,
        assignee: args.assignee ?? undefined,
        phase: args.phase ?? undefined,
        featureId: args.featureId ?? undefined,
        startDate: args.startDate ?? undefined,
        endDate: args.endDate ?? undefined,
      });
      return {
        afterSnapshot: ticket,
        resultSummary: { createdId: ticket.id, title: ticket.title },
      };
    },
  },
  {
    kind: "mutation",
    name: "update_ticket",
    description: "Update a kanban ticket. Requires approval.",
    inputSchema: updateTicketSchema,
    async dryRun(rawArgs) {
      const args = validate(updateTicketSchema, rawArgs);
      const existing = await getTicketStore().getById(args.id);
      if (!existing) throw new Error(`Ticket ${args.id} not found.`);
      const { id, ...updates } = args;
      return {
        intent: `Update ticket "${existing.title}"`,
        riskLevel: "medium",
        affectedRecords: [{ table: "tickets", id, label: existing.title }],
        previewDiff: { before: existing, update: updates },
        beforeSnapshot: existing,
        resultSummary: { action: "update", table: "tickets", id },
      };
    },
    async execute(rawArgs) {
      const args = validate(updateTicketSchema, rawArgs);
      const { id, ...updates } = args;
      const ticket = await getTicketStore().update(id, updates);
      if (!ticket) throw new Error(`Ticket ${id} not found.`);
      return {
        afterSnapshot: ticket,
        resultSummary: { updatedId: ticket.id, title: ticket.title },
      };
    },
  },
  {
    kind: "mutation",
    name: "delete_ticket",
    description: "Delete a kanban ticket. Requires approval.",
    inputSchema: idSchema,
    async dryRun(rawArgs) {
      const { id } = validate(idSchema, rawArgs);
      const existing = await getTicketStore().getById(id);
      if (!existing) throw new Error(`Ticket ${id} not found.`);
      return {
        intent: `Delete ticket "${existing.title}"`,
        riskLevel: "destructive",
        affectedRecords: [{ table: "tickets", id, label: existing.title }],
        previewDiff: { delete: existing },
        beforeSnapshot: existing,
        resultSummary: { action: "delete", table: "tickets", id },
      };
    },
    async execute(rawArgs) {
      const { id } = validate(idSchema, rawArgs);
      const removed = await getTicketStore().remove(id);
      if (!removed) throw new Error(`Ticket ${id} not found.`);
      return { resultSummary: { deletedId: id } };
    },
  },
  makeCreateUpdateDeleteTool({
    baseName: "version",
    tableName: "versions",
    createSchema: z
      .object({
        tag: z.string().trim().min(1),
        title: z.string().trim().min(1),
        description: nullableString,
        color: z.string().trim().min(1).default("#8FD1CB"),
        status: z.string().trim().min(1).default("planned"),
        startDate: nullableString,
        endDate: nullableString,
        sortOrder: z.number().int().optional(),
      })
      .strict(),
    updateSchema: z
      .object({
        id: z.string().trim().min(1),
        tag: z.string().trim().min(1).optional(),
        title: z.string().trim().min(1).optional(),
        description: nullableString,
        color: z.string().trim().optional(),
        status: z.string().trim().optional(),
        startDate: nullableString,
        endDate: nullableString,
        sortOrder: z.number().int().optional(),
      })
      .strict(),
    getById: (id) => getVersionStore().getById(id),
    create: (args) => getVersionStore().create(args as never),
    update: (id, args) => getVersionStore().update(id, args as never),
    remove: (id) => getVersionStore().remove(id),
  }),
  makeCreateUpdateDeleteTool({
    baseName: "feature",
    tableName: "features",
    createSchema: z
      .object({
        versionId: z.string().trim().min(1),
        title: z.string().trim().min(1),
        description: nullableString,
        color: nullableString,
        status: z.string().trim().min(1).default("planned"),
        assignee: nullableString,
        startDate: nullableString,
        endDate: nullableString,
        sortOrder: z.number().int().optional(),
      })
      .strict(),
    updateSchema: z
      .object({
        id: z.string().trim().min(1),
        versionId: z.string().trim().optional(),
        title: z.string().trim().optional(),
        description: nullableString,
        color: nullableString,
        status: z.string().trim().optional(),
        assignee: nullableString,
        startDate: nullableString,
        endDate: nullableString,
        sortOrder: z.number().int().optional(),
      })
      .strict(),
    getById: (id) => getFeatureStore().getById(id),
    create: (args) => getFeatureStore().create(args as never),
    update: (id, args) => getFeatureStore().update(id, args as never),
    remove: (id) => getFeatureStore().remove(id),
  }),
  makeCreateUpdateDeleteTool({
    baseName: "changelog_entry",
    tableName: "changelog_entries",
    createSchema: z
      .object({
        title: z.string().trim().min(1),
        category: z.string().trim().min(1).default("improvement"),
        versionId: nullableString,
        body: nullableString,
        commitSha: nullableString,
        prNumber: z.number().int().optional().nullable(),
        prTitle: nullableString,
        branch: nullableString,
        author: nullableString,
        diffSummary: nullableString,
      })
      .strict(),
    updateSchema: z
      .object({
        id: z.string().trim().min(1),
        title: z.string().trim().optional(),
        category: z.string().trim().optional(),
        versionId: nullableString,
        body: nullableString,
        commitSha: nullableString,
        prNumber: z.number().int().optional().nullable(),
        prTitle: nullableString,
        branch: nullableString,
        author: nullableString,
        diffSummary: nullableString,
      })
      .strict(),
    getById: (id) => getChangelogStore().getById(id),
    create: (args) => getChangelogStore().create(args as never),
    update: (id, args) => getChangelogStore().update(id, args as never),
    remove: (id) => getChangelogStore().remove(id),
  }),
  {
    kind: "mutation",
    name: "update_user_role",
    description: "Update a user's role. Requires approval.",
    inputSchema: updateUserRoleSchema,
    async dryRun(rawArgs) {
      const { id, role } = validate(updateUserRoleSchema, rawArgs);
      const existing = await getUserById(id);
      if (!existing) throw new Error(`User ${id} not found.`);
      return {
        intent: `Change ${existing.email} role to ${role}`,
        riskLevel: role === "admin" ? "high" : "medium",
        affectedRecords: [{ table: "users", id, label: existing.email }],
        previewDiff: { before: existing, update: { role } },
        beforeSnapshot: existing,
        resultSummary: { action: "update", table: "users", id, role },
      };
    },
    async execute(rawArgs, _operation, context) {
      const { id, role } = validate(updateUserRoleSchema, rawArgs);
      if (id === context.adminUser.id && role !== "admin") {
        throw new Error(
          "Refusing to remove admin from the currently signed-in user.",
        );
      }
      const [row] = await requireDb()
        .update(usersTable)
        .set({ role, updatedAt: new Date() })
        .where(eq(usersTable.id, id))
        .returning({
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
          role: usersTable.role,
          updatedAt: usersTable.updatedAt,
        });
      if (!row) throw new Error(`User ${id} not found.`);
      return {
        afterSnapshot: {
          ...row,
          updatedAt:
            row.updatedAt instanceof Date
              ? row.updatedAt.toISOString()
              : String(row.updatedAt),
        },
        resultSummary: { updatedId: row.id, email: row.email, role: row.role },
      };
    },
  },
  {
    kind: "mutation",
    name: "create_character",
    description: "Create a character profile. Requires approval.",
    inputSchema: createCharacterSchema,
    async dryRun(rawArgs) {
      const args = validate(createCharacterSchema, rawArgs);
      return {
        intent: `Create character "${args.title}"`,
        riskLevel: "medium",
        affectedRecords: [],
        previewDiff: { create: { table: "characters", values: args } },
        resultSummary: {
          action: "create",
          table: "characters",
          slug: args.slug,
        },
      };
    },
    async execute(rawArgs) {
      const args = validate(createCharacterSchema, rawArgs);
      const record = await getCharacterStore().create(
        cleanNulls(args) as never,
      );
      return {
        afterSnapshot: record,
        resultSummary: { createdId: record.id, title: record.title },
      };
    },
  },
  {
    kind: "mutation",
    name: "update_character",
    description:
      "Update a character profile, model layers, or voice binding. Requires approval.",
    inputSchema: updateCharacterSchema,
    async dryRun(rawArgs) {
      const args = validate(updateCharacterSchema, rawArgs);
      const existing = await getCharacterStore().getById(args.id);
      if (!existing) throw new Error(`Character ${args.id} not found.`);
      const { id, ...updates } = args;
      return {
        intent: `Update character "${existing.title}"`,
        riskLevel: "medium",
        affectedRecords: [{ table: "characters", id, label: existing.title }],
        previewDiff: { before: existing, update: updates },
        beforeSnapshot: existing,
        resultSummary: { action: "update", table: "characters", id },
      };
    },
    async execute(rawArgs) {
      const args = validate(updateCharacterSchema, rawArgs);
      const { id, ...updates } = args;
      const record = await getCharacterStore().update(
        id,
        cleanNulls(updates) as never,
      );
      if (!record) throw new Error(`Character ${id} not found.`);
      return {
        afterSnapshot: record,
        resultSummary: { updatedId: record.id, title: record.title },
      };
    },
  },
  {
    kind: "mutation",
    name: "delete_character",
    description: "Delete a character profile. Requires approval.",
    inputSchema: idSchema,
    async dryRun(rawArgs) {
      const { id } = validate(idSchema, rawArgs);
      const existing = await getCharacterStore().getById(id);
      if (!existing) throw new Error(`Character ${id} not found.`);
      const worldCount = await getCharacterStore().countWorldsFor(id);
      return {
        intent: `Delete character "${existing.title}"`,
        riskLevel: "destructive",
        affectedRecords: [
          { table: "characters", id, label: existing.title, worldCount },
        ],
        previewDiff: { delete: existing, related: { worldCount } },
        beforeSnapshot: existing,
        resultSummary: {
          action: "delete",
          table: "characters",
          id,
          worldCount,
        },
      };
    },
    async execute(rawArgs) {
      const { id } = validate(idSchema, rawArgs);
      const removed = await getCharacterStore().remove(id);
      if (!removed) throw new Error(`Character ${id} not found.`);
      return { resultSummary: { deletedId: id } };
    },
  },
  {
    kind: "mutation",
    name: "create_wiki",
    description: "Create a top-level wiki. Requires approval.",
    inputSchema: createWikiSchema,
    async dryRun(rawArgs) {
      const args = validate(createWikiSchema, rawArgs);
      return {
        intent: `Create wiki "${args.title}"`,
        riskLevel: "medium",
        affectedRecords: [],
        previewDiff: { create: { table: "wikis", values: args } },
        resultSummary: { action: "create", table: "wikis", slug: args.slug },
      };
    },
    async execute(rawArgs) {
      const args = validate(createWikiSchema, rawArgs);
      const record = await getWikisStore().createWiki(
        cleanNulls(args) as never,
      );
      return {
        afterSnapshot: record,
        resultSummary: { createdId: record.id, title: record.title },
      };
    },
  },
  {
    kind: "mutation",
    name: "update_wiki",
    description:
      "Update top-level wiki metadata and ingestion prompt. Requires approval.",
    inputSchema: updateWikiSchema,
    async dryRun(rawArgs) {
      const args = validate(updateWikiSchema, rawArgs);
      const existing = await getWikisStore().getWikiById(args.id);
      if (!existing) throw new Error(`Wiki ${args.id} not found.`);
      const { id, ...updates } = args;
      return {
        intent: `Update wiki "${existing.title}"`,
        riskLevel: "medium",
        affectedRecords: [{ table: "wikis", id, label: existing.title }],
        previewDiff: { before: existing, update: updates },
        beforeSnapshot: existing,
        resultSummary: { action: "update", table: "wikis", id },
      };
    },
    async execute(rawArgs) {
      const args = validate(updateWikiSchema, rawArgs);
      const { id, ...updates } = args;
      const record = await getWikisStore().updateWiki(
        id,
        cleanNulls(updates) as never,
      );
      if (!record) throw new Error(`Wiki ${id} not found.`);
      return {
        afterSnapshot: record,
        resultSummary: { updatedId: record.id, title: record.title },
      };
    },
  },
  {
    kind: "mutation",
    name: "delete_wiki",
    description:
      "Delete a top-level wiki and cascading wiki-owned content. Requires approval.",
    inputSchema: idSchema,
    async dryRun(rawArgs) {
      const { id } = validate(idSchema, rawArgs);
      const store = getWikisStore();
      const [wiki, pages, sources, ingestions, bindings] = await Promise.all([
        store.getWikiById(id),
        store.listPagesForWiki(id),
        store.listSourcesForWiki(id),
        store.listIngestionsForWiki(id, 100),
        store.listBindingsForWiki(id),
      ]);
      if (!wiki) throw new Error(`Wiki ${id} not found.`);
      return {
        intent: `Delete wiki "${wiki.title}"`,
        riskLevel: "destructive",
        affectedRecords: [
          {
            table: "wikis",
            id,
            label: wiki.title,
            pages: pages.length,
            sources: sources.length,
            ingestions: ingestions.length,
            bindings: bindings.length,
          },
        ],
        previewDiff: {
          delete: wiki,
          cascade: { pages, sources, ingestions, bindings },
        },
        beforeSnapshot: { wiki, pages, sources, ingestions, bindings },
        resultSummary: {
          action: "delete",
          table: "wikis",
          id,
          pages: pages.length,
          sources: sources.length,
          ingestions: ingestions.length,
          bindings: bindings.length,
        },
      };
    },
    async execute(rawArgs) {
      const { id } = validate(idSchema, rawArgs);
      const removed = await getWikisStore().deleteWiki(id);
      if (!removed) throw new Error(`Wiki ${id} not found.`);
      return { resultSummary: { deletedId: id } };
    },
  },
  {
    kind: "mutation",
    name: "create_wiki_binding",
    description: "Bind a character to a wiki. Requires approval.",
    inputSchema: createWikiBindingSchema,
    async dryRun(rawArgs) {
      const args = validate(createWikiBindingSchema, rawArgs);
      return {
        intent: `Bind character ${args.characterId} to wiki ${args.wikiId}`,
        riskLevel: "medium",
        affectedRecords: [
          { table: "characters", id: args.characterId },
          { table: "wikis", id: args.wikiId },
        ],
        previewDiff: {
          create: { table: "character_knowledge_bindings", values: args },
        },
        resultSummary: {
          action: "create",
          table: "character_knowledge_bindings",
        },
      };
    },
    async execute(rawArgs) {
      const args = validate(createWikiBindingSchema, rawArgs);
      const record = await getWikisStore().createBinding(args);
      return {
        afterSnapshot: record,
        resultSummary: {
          createdId: record.id,
          characterId: record.characterId,
          wikiId: record.wikiId,
        },
      };
    },
  },
  {
    kind: "mutation",
    name: "update_wiki_binding",
    description: "Update a character-wiki binding. Requires approval.",
    inputSchema: updateWikiBindingSchema,
    async dryRun(rawArgs) {
      const args = validate(updateWikiBindingSchema, rawArgs);
      const existing = await findWikiBindingById(args.id);
      if (!existing) throw new Error(`Wiki binding ${args.id} not found.`);
      const { id, ...updates } = args;
      return {
        intent: `Update wiki binding ${id}`,
        riskLevel: "medium",
        affectedRecords: [
          {
            table: "character_knowledge_bindings",
            id,
            characterId: existing.characterId,
            wikiId: existing.wikiId,
          },
        ],
        previewDiff: { before: existing, update: updates },
        beforeSnapshot: existing,
        resultSummary: {
          action: "update",
          table: "character_knowledge_bindings",
          id,
        },
      };
    },
    async execute(rawArgs) {
      const args = validate(updateWikiBindingSchema, rawArgs);
      const { id, ...updates } = args;
      const record = await getWikisStore().updateBinding(id, updates);
      if (!record) throw new Error(`Wiki binding ${id} not found.`);
      return { afterSnapshot: record, resultSummary: { updatedId: record.id } };
    },
  },
  {
    kind: "mutation",
    name: "delete_wiki_binding",
    description: "Delete a character-wiki binding. Requires approval.",
    inputSchema: idSchema,
    async dryRun(rawArgs) {
      const { id } = validate(idSchema, rawArgs);
      const existing = await findWikiBindingById(id);
      if (!existing) throw new Error(`Wiki binding ${id} not found.`);
      return {
        intent: `Delete wiki binding ${id}`,
        riskLevel: "destructive",
        affectedRecords: [
          {
            table: "character_knowledge_bindings",
            id,
            characterId: existing.characterId,
            wikiId: existing.wikiId,
          },
        ],
        previewDiff: { delete: existing },
        beforeSnapshot: existing,
        resultSummary: {
          action: "delete",
          table: "character_knowledge_bindings",
          id,
        },
      };
    },
    async execute(rawArgs) {
      const { id } = validate(idSchema, rawArgs);
      const removed = await getWikisStore().deleteBinding(id);
      if (!removed) throw new Error(`Wiki binding ${id} not found.`);
      return { resultSummary: { deletedId: id } };
    },
  },
  {
    kind: "mutation",
    name: "save_wiki_page",
    description: "Create or update a character/wiki page. Requires approval.",
    inputSchema: saveWikiPageSchema,
    async dryRun(rawArgs) {
      const args = validate(saveWikiPageSchema, rawArgs);
      if (!args.characterId && !args.wikiId)
        throw new Error("characterId or wikiId is required.");
      const existing = args.wikiId
        ? await getWikiStore().getPageByWikiSlug(args.wikiId, args.slug)
        : await getWikiStore().getPageBySlug(args.characterId!, args.slug);
      return {
        intent: `${existing ? "Update" : "Create"} wiki page "${args.title}"`,
        riskLevel: existing ? "medium" : "low",
        affectedRecords: existing
          ? [{ table: "wiki_pages", id: existing.id, label: existing.title }]
          : [],
        previewDiff: existing
          ? { before: existing, update: args }
          : { create: { table: "wiki_pages", values: args } },
        beforeSnapshot: existing,
        resultSummary: {
          action: existing ? "update" : "create",
          table: "wiki_pages",
          slug: args.slug,
        },
      };
    },
    async execute(rawArgs, _operation, context) {
      const args = validate(saveWikiPageSchema, rawArgs);
      if (!args.characterId && !args.wikiId)
        throw new Error("characterId or wikiId is required.");
      const result = await getWikiStore().savePage({
        ...cleanNulls(args),
        authorKind: "human",
        authorId: context.adminUser.id,
      } as never);
      return {
        afterSnapshot: result.page,
        resultSummary: {
          pageId: result.page.id,
          created: result.created,
          versionCreated: result.versionCreated,
          edgesAdded: result.edgesAdded,
          edgesRemoved: result.edgesRemoved,
        },
      };
    },
  },
  {
    kind: "mutation",
    name: "delete_wiki_page",
    description: "Delete a wiki page. Requires approval.",
    inputSchema: idSchema,
    async dryRun(rawArgs) {
      const { id } = validate(idSchema, rawArgs);
      const existing = await getWikiStore().getPage(id);
      if (!existing) throw new Error(`Wiki page ${id} not found.`);
      return {
        intent: `Delete wiki page "${existing.title}"`,
        riskLevel: "destructive",
        affectedRecords: [{ table: "wiki_pages", id, label: existing.title }],
        previewDiff: { delete: existing },
        beforeSnapshot: existing,
        resultSummary: { action: "delete", table: "wiki_pages", id },
      };
    },
    async execute(rawArgs) {
      const { id } = validate(idSchema, rawArgs);
      const removed = await getWikiStore().removePage(id);
      if (!removed) throw new Error(`Wiki page ${id} not found.`);
      return { resultSummary: { deletedId: id } };
    },
  },
  {
    kind: "mutation",
    name: "create_wiki_source",
    description: "Create a wiki source. Requires approval.",
    inputSchema: createWikiSourceSchema,
    async dryRun(rawArgs) {
      const args = validate(createWikiSourceSchema, rawArgs);
      if (!args.characterId && !args.wikiId)
        throw new Error("characterId or wikiId is required.");
      return {
        intent: `Create wiki source "${args.title}"`,
        riskLevel: "medium",
        affectedRecords: [],
        previewDiff: {
          create: {
            table: "wiki_sources",
            values: { ...args, content: `[${args.content.length} chars]` },
          },
        },
        resultSummary: {
          action: "create",
          table: "wiki_sources",
          title: args.title,
        },
      };
    },
    async execute(rawArgs) {
      const args = validate(createWikiSourceSchema, rawArgs);
      if (!args.characterId && !args.wikiId)
        throw new Error("characterId or wikiId is required.");
      const record = await getWikiStore().createSource(
        cleanNulls(args) as never,
      );
      return {
        afterSnapshot: record,
        resultSummary: { createdId: record.id, title: record.title },
      };
    },
  },
  makeDeleteWikiSourceTool("remove_wiki_source", false),
  makeDeleteWikiSourceTool("purge_wiki_source", true),
  {
    kind: "mutation",
    name: "queue_wiki_ingestion",
    description:
      "Create a queued or running wiki ingestion log row. Requires approval.",
    inputSchema: startIngestionSchema,
    async dryRun(rawArgs) {
      const args = validate(startIngestionSchema, rawArgs);
      if (!args.characterId && !args.wikiId)
        throw new Error("characterId or wikiId is required.");
      return {
        intent: `Queue wiki ingestion${args.sourceId ? ` for source ${args.sourceId}` : ""}`,
        riskLevel: "medium",
        affectedRecords: args.sourceId
          ? [{ table: "wiki_sources", id: args.sourceId }]
          : [],
        previewDiff: { create: { table: "wiki_ingestion_log", values: args } },
        resultSummary: { action: "create", table: "wiki_ingestion_log" },
      };
    },
    async execute(rawArgs) {
      const args = validate(startIngestionSchema, rawArgs);
      if (!args.characterId && !args.wikiId)
        throw new Error("characterId or wikiId is required.");
      const record = await getWikiStore().startIngestion(
        cleanNulls(args) as never,
      );
      return {
        afterSnapshot: record,
        resultSummary: { createdId: record.id, status: record.status },
      };
    },
  },
  {
    kind: "mutation",
    name: "finish_wiki_ingestion",
    description:
      "Mark a wiki ingestion run succeeded, failed, or canceled. Requires approval.",
    inputSchema: finishIngestionSchema,
    async dryRun(rawArgs) {
      const args = validate(finishIngestionSchema, rawArgs);
      const existing = await getWikiStore().getIngestionRun(args.id);
      if (!existing) throw new Error(`Ingestion run ${args.id} not found.`);
      const { id, ...result } = args;
      return {
        intent: `Mark ingestion run ${id} as ${args.status}`,
        riskLevel: args.status === "succeeded" ? "medium" : "high",
        affectedRecords: [
          { table: "wiki_ingestion_log", id, label: existing.status },
        ],
        previewDiff: { before: existing, update: result },
        beforeSnapshot: existing,
        resultSummary: {
          action: "finish",
          table: "wiki_ingestion_log",
          id,
          status: args.status,
        },
      };
    },
    async execute(rawArgs) {
      const args = validate(finishIngestionSchema, rawArgs);
      const { id, ...result } = args;
      const record = await getWikiStore().finishIngestion(
        id,
        cleanNulls(result) as never,
      );
      if (!record) throw new Error(`Ingestion run ${id} not found.`);
      return {
        afterSnapshot: record,
        resultSummary: { updatedId: record.id, status: record.status },
      };
    },
  },
  {
    kind: "mutation",
    name: "purge_wiki_ingestion_run",
    description:
      "Purge an ingestion run and any uniquely owned source/pages. Requires approval.",
    inputSchema: idSchema,
    async dryRun(rawArgs) {
      const { id } = validate(idSchema, rawArgs);
      const existing = await getWikiStore().getIngestionRun(id);
      if (!existing) throw new Error(`Ingestion run ${id} not found.`);
      return {
        intent: `Purge wiki ingestion run ${id}`,
        riskLevel: "destructive",
        affectedRecords: [
          { table: "wiki_ingestion_log", id, sourceId: existing.sourceId },
        ],
        previewDiff: {
          delete: existing,
          note: "May purge the run source and orphan pages if no other run uses that source.",
        },
        beforeSnapshot: existing,
        resultSummary: { action: "purge", table: "wiki_ingestion_log", id },
      };
    },
    async execute(rawArgs) {
      const { id } = validate(idSchema, rawArgs);
      const result = await getWikiStore().purgeIngestionRun(id);
      return { resultSummary: result };
    },
  },
  {
    kind: "mutation",
    name: "reset_character_wiki_data",
    description:
      "Wipe all ingested wiki data for one character while keeping the character row. Requires approval.",
    inputSchema: z.object({ characterId: z.string().trim().min(1) }).strict(),
    async dryRun(rawArgs) {
      const { characterId } = validate(
        z.object({ characterId: z.string().trim().min(1) }).strict(),
        rawArgs,
      );
      const character = await getCharacterStore().getById(characterId);
      if (!character) throw new Error(`Character ${characterId} not found.`);
      const [pages, sources, runs] = await Promise.all([
        getWikiStore().listPages(characterId),
        getWikiStore().listSources(characterId),
        getWikiStore().listIngestionRuns(characterId, 100),
      ]);
      return {
        intent: `Reset ingested wiki data for "${character.title}"`,
        riskLevel: "destructive",
        affectedRecords: [
          {
            table: "characters",
            id: characterId,
            label: character.title,
            pages: pages.length,
            sources: sources.length,
            runs: runs.length,
          },
        ],
        previewDiff: { delete: { pages, sources, runs } },
        beforeSnapshot: { character, pages, sources, runs },
        resultSummary: {
          action: "reset",
          characterId,
          pages: pages.length,
          sources: sources.length,
          runs: runs.length,
        },
      };
    },
    async execute(rawArgs) {
      const { characterId } = validate(
        z.object({ characterId: z.string().trim().min(1) }).strict(),
        rawArgs,
      );
      const result = await getWikiStore().resetCharacterData(characterId);
      return { resultSummary: result };
    },
  },
  {
    kind: "mutation",
    name: "create_voice",
    description: "Create a voice record. Requires approval.",
    inputSchema: createVoiceSchema,
    async dryRun(rawArgs) {
      const args = validate(createVoiceSchema, rawArgs);
      return {
        intent: `Create voice "${args.name}"`,
        riskLevel: "medium",
        affectedRecords: [],
        previewDiff: { create: { table: "voices", values: args } },
        resultSummary: { action: "create", table: "voices", slug: args.slug },
      };
    },
    async execute(rawArgs, _operation, context) {
      const args = validate(createVoiceSchema, rawArgs);
      const record = await getVoiceStore().create({
        ...cleanNulls(args),
        createdBy: context.adminUser.id,
      } as never);
      return {
        afterSnapshot: record,
        resultSummary: { createdId: record.id, name: record.name },
      };
    },
  },
  {
    kind: "mutation",
    name: "update_voice",
    description: "Update a voice record. Requires approval.",
    inputSchema: updateVoiceSchema,
    async dryRun(rawArgs) {
      const args = validate(updateVoiceSchema, rawArgs);
      const existing = await getVoiceStore().getById(args.id);
      if (!existing) throw new Error(`Voice ${args.id} not found.`);
      const { id, ...updates } = args;
      return {
        intent: `Update voice "${existing.name}"`,
        riskLevel: "medium",
        affectedRecords: [{ table: "voices", id, label: existing.name }],
        previewDiff: { before: existing, update: updates },
        beforeSnapshot: existing,
        resultSummary: { action: "update", table: "voices", id },
      };
    },
    async execute(rawArgs, _operation, context) {
      const args = validate(updateVoiceSchema, rawArgs);
      const { id, ...updates } = args;
      const record = await getVoiceStore().update(id, {
        ...cleanNulls(updates),
        updatedBy: context.adminUser.id,
      } as never);
      if (!record) throw new Error(`Voice ${id} not found.`);
      return {
        afterSnapshot: record,
        resultSummary: { updatedId: record.id, name: record.name },
      };
    },
  },
  makeVoiceArchiveTool("archive_voice", true),
  makeVoiceArchiveTool("unarchive_voice", false),
  {
    kind: "mutation",
    name: "delete_voice",
    description:
      "Hard-delete a voice record. Prefer archive_voice. Requires approval.",
    inputSchema: idSchema,
    async dryRun(rawArgs) {
      const { id } = validate(idSchema, rawArgs);
      const existing = await getVoiceStore().getById(id);
      if (!existing) throw new Error(`Voice ${id} not found.`);
      const boundCharacters = await getVoiceStore().listBoundCharacters(id);
      return {
        intent: `Hard-delete voice "${existing.name}"`,
        riskLevel: "destructive",
        affectedRecords: [
          {
            table: "voices",
            id,
            label: existing.name,
            boundCharacters: boundCharacters.length,
          },
        ],
        previewDiff: { delete: existing, related: { boundCharacters } },
        beforeSnapshot: { voice: existing, boundCharacters },
        resultSummary: {
          action: "delete",
          table: "voices",
          id,
          boundCharacters: boundCharacters.length,
        },
      };
    },
    async execute(rawArgs) {
      const { id } = validate(idSchema, rawArgs);
      const removed = await getVoiceStore().remove(id);
      if (!removed) throw new Error(`Voice ${id} not found.`);
      return { resultSummary: { deletedId: id } };
    },
  },
  {
    kind: "mutation",
    name: "add_voice_preview",
    description: "Add a voice preview artifact reference. Requires approval.",
    inputSchema: voicePreviewSchema,
    async dryRun(rawArgs) {
      const args = validate(voicePreviewSchema, rawArgs);
      const voice = await getVoiceStore().getById(args.voiceId);
      if (!voice) throw new Error(`Voice ${args.voiceId} not found.`);
      return {
        intent: `Add preview "${args.label}" to voice "${voice.name}"`,
        riskLevel: "low",
        affectedRecords: [{ table: "voices", id: voice.id, label: voice.name }],
        previewDiff: { create: { table: "voice_previews", values: args } },
        resultSummary: {
          action: "create",
          table: "voice_previews",
          voiceId: voice.id,
        },
      };
    },
    async execute(rawArgs) {
      const args = validate(voicePreviewSchema, rawArgs);
      const record = await getVoiceStore().addPreview(
        args.voiceId,
        cleanNulls(args) as never,
      );
      return {
        afterSnapshot: record,
        resultSummary: { createdId: record.id, voiceId: record.voiceId },
      };
    },
  },
  makeSimpleVoiceIdTool(
    "start_voice_extraction_attempt",
    "Start a voice extraction attempt.",
    "high",
    async (voiceId) => getVoiceStore().startAttempt(voiceId),
  ),
  {
    kind: "mutation",
    name: "finish_voice_extraction_attempt",
    description: "Finish a voice extraction attempt. Requires approval.",
    inputSchema: finishVoiceAttemptSchema,
    async dryRun(rawArgs) {
      const args = validate(finishVoiceAttemptSchema, rawArgs);
      return {
        intent: `Mark voice extraction attempt ${args.attemptId} as ${args.status}`,
        riskLevel: args.status === "failed" ? "high" : "medium",
        affectedRecords: [
          { table: "voice_extraction_attempts", id: args.attemptId },
        ],
        previewDiff: {
          update: { table: "voice_extraction_attempts", values: args },
        },
        resultSummary: {
          action: "finish",
          table: "voice_extraction_attempts",
          id: args.attemptId,
        },
      };
    },
    async execute(rawArgs) {
      const args = validate(finishVoiceAttemptSchema, rawArgs);
      const record = await getVoiceStore().finishAttempt(args.attemptId, {
        status: args.status,
        error: args.error ?? null,
      });
      if (!record)
        throw new Error(
          `Voice extraction attempt ${args.attemptId} not found.`,
        );
      return {
        afterSnapshot: record,
        resultSummary: { updatedId: record.id, status: record.status },
      };
    },
  },
  {
    kind: "mutation",
    name: "remove_voice_preview",
    description:
      "Remove a voice preview artifact reference. Requires approval.",
    inputSchema: idSchema,
    async dryRun(rawArgs) {
      const { id } = validate(idSchema, rawArgs);
      return {
        intent: `Remove voice preview ${id}`,
        riskLevel: "destructive",
        affectedRecords: [{ table: "voice_previews", id }],
        previewDiff: { delete: { table: "voice_previews", id } },
        resultSummary: { action: "delete", table: "voice_previews", id },
      };
    },
    async execute(rawArgs) {
      const { id } = validate(idSchema, rawArgs);
      const removed = await getVoiceStore().removePreview(id);
      if (!removed) throw new Error(`Voice preview ${id} not found.`);
      return { resultSummary: { deletedId: id } };
    },
  },
  {
    kind: "mutation",
    name: "create_eval_suite",
    description: "Create and publish an eval suite. Requires approval.",
    inputSchema: createEvalSuiteSchema,
    async dryRun(rawArgs) {
      const args = validate(createEvalSuiteSchema, rawArgs);
      return {
        intent: `Create eval suite "${args.slug}"`,
        riskLevel: "medium",
        affectedRecords: [{ table: "characters", id: args.characterId }],
        previewDiff: { create: { table: "eval_suites", values: args } },
        resultSummary: {
          action: "create",
          table: "eval_suites",
          slug: args.slug,
          probes: args.probes.length,
        },
      };
    },
    async execute(rawArgs, _operation, context) {
      const args = validate(createEvalSuiteSchema, rawArgs);
      const record = await getEvalStore().createSuite({
        ...cleanNulls(args),
        createdBy: context.adminUser.id,
      } as never);
      return {
        afterSnapshot: record,
        resultSummary: {
          createdId: record.id,
          slug: record.slug,
          version: record.version,
        },
      };
    },
  },
  makeEvalLifecycleTool("fork_eval_draft", forkEvalDraftSchema),
  makeEvalLifecycleTool("update_eval_draft", updateEvalDraftSchema),
  makeEvalLifecycleTool("publish_eval_draft", publishEvalDraftSchema),
  makeEvalLifecycleTool(
    "delete_eval_draft",
    z.object({ suiteId: z.string().trim().min(1) }).strict(),
  ),
  makeEvalLifecycleTool("mark_eval_run_running", markEvalRunRunningSchema),
  makeEvalLifecycleTool("mark_eval_run_errored", markEvalRunErroredSchema),
  {
    kind: "mutation",
    name: "create_pending_eval_sweep",
    description: "Create a pending eval sweep. Requires approval.",
    inputSchema: createPendingSweepSchema,
    async dryRun(rawArgs) {
      const args = validate(createPendingSweepSchema, rawArgs);
      return {
        intent: `Create pending eval sweep for suite ${args.suiteId}`,
        riskLevel: "high",
        affectedRecords: [
          { table: "characters", id: args.characterId },
          { table: "eval_suites", id: args.suiteId },
        ],
        previewDiff: { create: { table: "eval_sweeps", values: args } },
        resultSummary: {
          action: "create",
          table: "eval_sweeps",
          configs: args.configs.length,
        },
      };
    },
    async execute(rawArgs, _operation, context) {
      const args = validate(createPendingSweepSchema, rawArgs);
      const record = await getEvalStore().createPendingSweep({
        ...cleanNulls(args),
        createdBy: context.adminUser.id,
      } as never);
      return {
        afterSnapshot: record,
        resultSummary: { createdId: record.id, status: record.status },
      };
    },
  },
  makeEvalLifecycleTool("mark_eval_sweep_errored", markSweepErroredSchema),
] satisfies Array<AdminAgentMutationTool | AdminAgentMutationTool[]>;

function makeCreateUpdateDeleteTool(opts: {
  baseName: string;
  tableName: string;
  createSchema: z.ZodTypeAny;
  updateSchema: z.ZodTypeAny;
  getById: (id: string) => Promise<unknown | null>;
  create: (args: Record<string, unknown>) => Promise<unknown>;
  update: (
    id: string,
    args: Record<string, unknown>,
  ) => Promise<unknown | null>;
  remove: (id: string) => Promise<boolean>;
}): AdminAgentMutationTool[] {
  const label = (record: unknown) =>
    typeof record === "object" && record
      ? String(
          (
            record as {
              title?: unknown;
              tag?: unknown;
              name?: unknown;
              id?: unknown;
            }
          ).title ??
            (record as { tag?: unknown }).tag ??
            (record as { name?: unknown }).name ??
            (record as { id?: unknown }).id ??
            opts.baseName,
        )
      : opts.baseName;

  return [
    {
      kind: "mutation",
      name: `create_${opts.baseName}`,
      description: `Create ${opts.baseName}. Requires approval.`,
      inputSchema: opts.createSchema,
      async dryRun(rawArgs) {
        const args = validate(opts.createSchema, rawArgs);
        return {
          intent: `Create ${opts.baseName}`,
          riskLevel: "low",
          affectedRecords: [],
          previewDiff: { create: { table: opts.tableName, values: args } },
          resultSummary: { action: "create", table: opts.tableName },
        };
      },
      async execute(rawArgs) {
        const args = validate(opts.createSchema, rawArgs) as Record<
          string,
          unknown
        >;
        const record = await opts.create(cleanNulls(args));
        return {
          afterSnapshot: record,
          resultSummary: { action: "created", table: opts.tableName, record },
        };
      },
    },
    {
      kind: "mutation",
      name: `update_${opts.baseName}`,
      description: `Update ${opts.baseName}. Requires approval.`,
      inputSchema: opts.updateSchema,
      async dryRun(rawArgs) {
        const args = validate(opts.updateSchema, rawArgs) as Record<
          string,
          unknown
        > & { id: string };
        const existing = await opts.getById(args.id);
        if (!existing)
          throw new Error(`${opts.baseName} ${args.id} not found.`);
        const { id, ...updates } = args;
        return {
          intent: `Update ${opts.baseName} "${label(existing)}"`,
          riskLevel: "medium",
          affectedRecords: [
            { table: opts.tableName, id, label: label(existing) },
          ],
          previewDiff: { before: existing, update: updates },
          beforeSnapshot: existing,
          resultSummary: { action: "update", table: opts.tableName, id },
        };
      },
      async execute(rawArgs) {
        const args = validate(opts.updateSchema, rawArgs) as Record<
          string,
          unknown
        > & { id: string };
        const { id, ...updates } = args;
        const record = await opts.update(id, cleanNulls(updates));
        if (!record) throw new Error(`${opts.baseName} ${id} not found.`);
        return {
          afterSnapshot: record,
          resultSummary: { action: "updated", table: opts.tableName, record },
        };
      },
    },
    {
      kind: "mutation",
      name: `delete_${opts.baseName}`,
      description: `Delete ${opts.baseName}. Requires approval.`,
      inputSchema: idSchema,
      async dryRun(rawArgs) {
        const { id } = validate(idSchema, rawArgs);
        const existing = await opts.getById(id);
        if (!existing) throw new Error(`${opts.baseName} ${id} not found.`);
        return {
          intent: `Delete ${opts.baseName} "${label(existing)}"`,
          riskLevel: "destructive",
          affectedRecords: [
            { table: opts.tableName, id, label: label(existing) },
          ],
          previewDiff: { delete: existing },
          beforeSnapshot: existing,
          resultSummary: { action: "delete", table: opts.tableName, id },
        };
      },
      async execute(rawArgs) {
        const { id } = validate(idSchema, rawArgs);
        const removed = await opts.remove(id);
        if (!removed) throw new Error(`${opts.baseName} ${id} not found.`);
        return {
          resultSummary: { action: "deleted", table: opts.tableName, id },
        };
      },
    },
  ];
}

function makeDeleteWikiSourceTool(
  name: "remove_wiki_source" | "purge_wiki_source",
  purge: boolean,
): AdminAgentMutationTool {
  return {
    kind: "mutation",
    name,
    description: `${purge ? "Purge" : "Remove"} a wiki source${purge ? " and orphaned pages" : ""}. Requires approval.`,
    inputSchema: idSchema,
    async dryRun(rawArgs) {
      const { id } = validate(idSchema, rawArgs);
      const existing = await getWikiStore().getSource(id);
      if (!existing) throw new Error(`Wiki source ${id} not found.`);
      const purgePreview = purge
        ? await getWikiStore().previewPurgeSource(id)
        : null;
      return {
        intent: `${purge ? "Purge" : "Remove"} wiki source "${existing.title}"`,
        riskLevel: purge ? "destructive" : "high",
        affectedRecords: [
          {
            table: "wiki_sources",
            id,
            label: existing.title,
            ...(purgePreview ?? {}),
          },
        ],
        previewDiff: { delete: existing, purgePreview },
        beforeSnapshot: existing,
        resultSummary: {
          action: purge ? "purge" : "delete",
          table: "wiki_sources",
          id,
          purgePreview,
        },
      };
    },
    async execute(rawArgs) {
      const { id } = validate(idSchema, rawArgs);
      if (purge) {
        const result = await getWikiStore().purgeSource(id);
        return { resultSummary: result };
      }
      const removed = await getWikiStore().removeSource(id);
      if (!removed) throw new Error(`Wiki source ${id} not found.`);
      return { resultSummary: { deletedId: id } };
    },
  };
}

function makeVoiceArchiveTool(
  name: "archive_voice" | "unarchive_voice",
  archive: boolean,
): AdminAgentMutationTool {
  return {
    kind: "mutation",
    name,
    description: `${archive ? "Archive" : "Unarchive"} a voice. Requires approval.`,
    inputSchema: idSchema,
    async dryRun(rawArgs) {
      const { id } = validate(idSchema, rawArgs);
      const existing = await getVoiceStore().getById(id);
      if (!existing) throw new Error(`Voice ${id} not found.`);
      return {
        intent: `${archive ? "Archive" : "Unarchive"} voice "${existing.name}"`,
        riskLevel: archive ? "high" : "medium",
        affectedRecords: [{ table: "voices", id, label: existing.name }],
        previewDiff: {
          before: existing,
          update: { archivedAt: archive ? "(now)" : null },
        },
        beforeSnapshot: existing,
        resultSummary: {
          action: archive ? "archive" : "unarchive",
          table: "voices",
          id,
        },
      };
    },
    async execute(rawArgs, _operation, context) {
      const { id } = validate(idSchema, rawArgs);
      const record = archive
        ? await getVoiceStore().archive(id, context.adminUser.id)
        : await getVoiceStore().unarchive(id, context.adminUser.id);
      if (!record) throw new Error(`Voice ${id} not found.`);
      return {
        afterSnapshot: record,
        resultSummary: { updatedId: record.id, archivedAt: record.archivedAt },
      };
    },
  };
}

function makeSimpleVoiceIdTool(
  name: string,
  description: string,
  riskLevel: AdminAgentDryRunResult["riskLevel"],
  executeFn: (voiceId: string) => Promise<unknown>,
): AdminAgentMutationTool {
  return {
    kind: "mutation",
    name,
    description: `${description} Requires approval.`,
    inputSchema: z.object({ voiceId: z.string().trim().min(1) }).strict(),
    async dryRun(rawArgs) {
      const { voiceId } = validate(
        z.object({ voiceId: z.string().trim().min(1) }).strict(),
        rawArgs,
      );
      const existing = await getVoiceStore().getById(voiceId);
      if (!existing) throw new Error(`Voice ${voiceId} not found.`);
      return {
        intent: description,
        riskLevel,
        affectedRecords: [
          { table: "voices", id: voiceId, label: existing.name },
        ],
        previewDiff: { action: name, voice: existing },
        beforeSnapshot: existing,
        resultSummary: { action: name, voiceId },
      };
    },
    async execute(rawArgs) {
      const { voiceId } = validate(
        z.object({ voiceId: z.string().trim().min(1) }).strict(),
        rawArgs,
      );
      const result = await executeFn(voiceId);
      return { afterSnapshot: result, resultSummary: result };
    },
  };
}

function makeEvalLifecycleTool(
  name: string,
  inputSchema: z.ZodTypeAny,
): AdminAgentMutationTool {
  return {
    kind: "mutation",
    name,
    description: `Run eval lifecycle operation ${name}. Requires approval.`,
    inputSchema,
    async dryRun(rawArgs) {
      const args = validate(inputSchema, rawArgs) as Record<string, unknown>;
      const beforeSnapshot = await getEvalLifecycleBefore(name, args);
      return {
        intent: name.replaceAll("_", " "),
        riskLevel:
          name.includes("delete") || name.includes("errored")
            ? "high"
            : "medium",
        affectedRecords: [
          {
            table: evalLifecycleTable(name),
            id: String(
              args.suiteId ?? args.sourceId ?? args.runId ?? args.sweepId ?? "",
            ),
          },
        ],
        previewDiff: { before: beforeSnapshot, update: args },
        beforeSnapshot,
        resultSummary: { action: name, table: evalLifecycleTable(name) },
      };
    },
    async execute(rawArgs, _operation, context) {
      const args = validate(inputSchema, rawArgs) as Record<string, unknown>;
      const store = getEvalStore();
      if (name === "fork_eval_draft") {
        const record = await store.forkDraft({
          sourceId: String(args.sourceId),
          version: args.version as string | undefined,
          createdBy: context.adminUser.id,
        });
        return {
          afterSnapshot: record,
          resultSummary: {
            createdId: record.id,
            slug: record.slug,
            version: record.version,
          },
        };
      }
      if (name === "update_eval_draft") {
        const suiteId = String(args.suiteId);
        const record = await store.updateDraft(
          suiteId,
          cleanNulls({
            probes: args.probes,
            releaseNotes: args.releaseNotes,
          }) as never,
        );
        return {
          afterSnapshot: record,
          resultSummary: {
            updatedId: record.id,
            slug: record.slug,
            version: record.version,
          },
        };
      }
      if (name === "publish_eval_draft") {
        const record = await store.publishDraft(
          String(args.suiteId),
          args.version ? { version: String(args.version) } : undefined,
        );
        return {
          afterSnapshot: record,
          resultSummary: { publishedId: record.id, version: record.version },
        };
      }
      if (name === "delete_eval_draft") {
        const suiteId = String(args.suiteId);
        await store.deleteDraft(suiteId);
        return { resultSummary: { deletedId: suiteId } };
      }
      if (name === "mark_eval_run_running") {
        await store.markRunRunning(String(args.runId), Number(args.total));
        const record = await store.getRun(String(args.runId));
        return {
          afterSnapshot: record,
          resultSummary: { runId: args.runId, status: "running" },
        };
      }
      if (name === "mark_eval_run_errored") {
        await store.markRunErrored(
          String(args.runId),
          String(args.errorMessage),
        );
        const record = await store.getRun(String(args.runId));
        return {
          afterSnapshot: record,
          resultSummary: { runId: args.runId, status: "errored" },
        };
      }
      if (name === "mark_eval_sweep_errored") {
        await store.markSweepErrored(
          String(args.sweepId),
          String(args.errorMessage),
        );
        const record = await store.getSweep(String(args.sweepId));
        return {
          afterSnapshot: record,
          resultSummary: { sweepId: args.sweepId, status: "errored" },
        };
      }
      throw new Error(`Unsupported eval lifecycle tool ${name}.`);
    },
  };
}

async function getEvalLifecycleBefore(
  name: string,
  args: Record<string, unknown>,
) {
  const store = getEvalStore();
  if (name === "fork_eval_draft") return store.getSuite(String(args.sourceId));
  if (name.includes("eval_draft")) return store.getSuite(String(args.suiteId));
  if (name.includes("eval_run")) return store.getRun(String(args.runId));
  if (name.includes("eval_sweep")) return store.getSweep(String(args.sweepId));
  return null;
}

function evalLifecycleTable(name: string) {
  if (name.includes("run")) return "eval_runs";
  if (name.includes("sweep")) return "eval_sweeps";
  return "eval_suites";
}

async function findWikiBindingById(id: string) {
  const [row] = await requireDb()
    .select()
    .from(characterKnowledgeBindingsTable)
    .where(eq(characterKnowledgeBindingsTable.id, id))
    .limit(1);
  return row
    ? {
        id: row.id,
        characterId: row.characterId,
        wikiId: row.wikiId,
        priority: row.priority,
        isActive: row.isActive,
        createdAt:
          row.createdAt instanceof Date
            ? row.createdAt.toISOString()
            : String(row.createdAt),
        updatedAt:
          row.updatedAt instanceof Date
            ? row.updatedAt.toISOString()
            : String(row.updatedAt),
      }
    : null;
}


type EntityType = z.infer<typeof entityTypeSchema>;
type PatchableEntityType = z.infer<typeof patchableEntityTypeSchema>;
type EntityFilter = z.infer<typeof entityFilterSchema>;
type BatchOperationInput = z.infer<
  typeof proposeOperationBatchSchema
>["operations"][number];
type SemanticSearchDomain = z.infer<typeof semanticSearchDomainSchema>;

type SemanticCandidate = {
  domain: SemanticSearchDomain;
  sourceType: string;
  id: string;
  label: string;
  text: string;
  metadata?: Record<string, unknown>;
};

const ENTITY_PATCH_FIELDS: Record<PatchableEntityType, string[]> = {
  tickets: [
    "title",
    "description",
    "status",
    "domain",
    "priority",
    "assignee",
    "phase",
    "featureId",
    "sortOrder",
    "startDate",
    "endDate",
    "subtasks",
    "activity",
  ],
  versions: ["tag", "title", "description", "status", "sortOrder"],
  features: ["versionId", "title", "summary", "status", "sortOrder"],
  platform_versions: ["name", "status", "summary", "releasedAt"],
  changelog_entries: ["title", "body", "category", "versionId"],
  characters: [
    "title",
    "summary",
    "image",
    "thumbnailColor",
    "eras",
    "ingestionPrompt",
    "identity",
    "voiceStyle",
    "brainModel",
    "directive",
    "voiceId",
    "voiceSettings",
  ],
  wikis: ["title", "summary", "eras", "ingestionPrompt", "ingestionPromptName"],
  wiki_pages: [
    "type",
    "title",
    "summary",
    "body",
    "frontmatter",
    "perspective",
    "confidence",
    "timeIndex",
    "knowsFuture",
    "contradictions",
  ],
  voices: [
    "name",
    "description",
    "provider",
    "providerConfig",
    "sourcePath",
    "durationS",
    "sampleRate",
    "tags",
    "language",
    "gender",
    "license",
    "attribution",
    "status",
    "statusError",
    "embeddingPath",
    "previewPath",
    "archivedAt",
  ],
};

async function listEntityRecords(
  entityType: EntityType,
  filters: EntityFilter[] = [],
  limit = 50,
): Promise<unknown[]> {
  switch (entityType) {
    case "users":
      return requireDb()
        .select({
          id: usersTable.id,
          name: usersTable.name,
          email: usersTable.email,
          role: usersTable.role,
          image: usersTable.image,
          createdAt: usersTable.createdAt,
          updatedAt: usersTable.updatedAt,
        })
        .from(usersTable)
        .limit(limit);
    case "tickets":
      return (await getTicketStore().list()).slice(0, limit);
    case "versions":
      return (await getVersionStore().list()).slice(0, limit);
    case "features": {
      const versionId = stringFilterValue(filters, "versionId");
      return (await getFeatureStore().list(versionId)).slice(0, limit);
    }
    case "platform_versions":
      return (await getPlatformVersionStore().list()).slice(0, limit);
    case "changelog_entries":
      return (await getChangelogStore().list()).slice(0, limit);
    case "characters":
      return (await getCharacterStore().list()).slice(0, limit);
    case "wikis":
      return (await getWikisStore().listWikiSummaries()).slice(0, limit);
    case "wiki_pages":
      return listWikiPageEntities(filters, limit);
    case "voices":
      return (await getVoiceStore().list({ includeArchived: true })).slice(
        0,
        limit,
      );
    case "worlds":
      return [];
    case "world_sessions":
      return (
        await getSceneSessionStore().listSessionSummaries(Math.max(limit, 100))
      ).slice(0, limit);
    case "eval_suites": {
      const characterId = stringFilterValue(filters, "characterId");
      return characterId
        ? (await getEvalStore().listSuites(characterId)).slice(0, limit)
        : [];
    }
    case "eval_runs": {
      const characterId = stringFilterValue(filters, "characterId");
      return characterId
        ? (await getEvalStore().listRuns({ characterId, limit })).slice(
            0,
            limit,
          )
        : [];
    }
    case "eval_sweeps": {
      const characterId = stringFilterValue(filters, "characterId");
      return characterId
        ? (await getEvalStore().listSweeps(characterId)).slice(0, limit)
        : [];
    }
  }
}

async function getEntityRecord(
  entityType: EntityType,
  id: string,
): Promise<unknown | null> {
  switch (entityType) {
    case "users":
      return getUserById(id);
    case "tickets":
      return getTicketStore().getById(id);
    case "versions":
      return getVersionStore().getById(id);
    case "features":
      return getFeatureStore().getById(id);
    case "platform_versions":
      return getPlatformVersionStore().getById(id);
    case "changelog_entries":
      return getChangelogStore().getById(id);
    case "characters":
      return getCharacterStore().getById(id);
    case "wikis":
      return getWikisStore().getWikiById(id);
    case "wiki_pages":
      return getWikiStore().getPage(id);
    case "voices":
      return getVoiceStore().getById(id);
    case "worlds":
      return null;
    case "world_sessions":
      return getSceneSessionStore().getSessionDetail(id);
    case "eval_suites":
      return getEvalStore().getSuite(id);
    case "eval_runs":
      return getEvalStore().getRunWithProbes(id);
    case "eval_sweeps":
      return getEvalStore().getSweep(id);
  }
}

async function listWikiPageEntities(filters: EntityFilter[], limit: number) {
  const wikiId = stringFilterValue(filters, "wikiId");
  if (wikiId)
    return (await getWikiStore().listPagesForWiki(wikiId)).slice(0, limit);

  const characterId = stringFilterValue(filters, "characterId");
  if (characterId)
    return (await getWikiStore().listPages(characterId)).slice(0, limit);

  const wikis = (await getWikisStore().listWikiSummaries()).slice(0, 20);
  const pages = await Promise.all(
    wikis.map((wiki) =>
      getWikiStore()
        .listPagesForWiki(wiki.id)
        .catch(() => []),
    ),
  );
  return pages.flat().slice(0, limit);
}

function applyEntityFilters(records: unknown[], filters: EntityFilter[]) {
  if (filters.length === 0) return records;
  return records.filter((record) =>
    filters.every((filter) => matchesEntityFilter(record, filter)),
  );
}

function matchesEntityFilter(record: unknown, filter: EntityFilter) {
  assertSafeFieldPath(filter.field);
  const actual = getPath(record, filter.field);
  switch (filter.op) {
    case "eq":
      return looseEqual(actual, filter.value);
    case "neq":
      return !looseEqual(actual, filter.value);
    case "contains":
      return String(actual ?? "")
        .toLowerCase()
        .includes(String(filter.value ?? "").toLowerCase());
    case "startsWith":
      return String(actual ?? "")
        .toLowerCase()
        .startsWith(String(filter.value ?? "").toLowerCase());
    case "in":
      return (filter.values ?? []).some((value) => looseEqual(actual, value));
  }
}

function searchRecords(records: unknown[], query: string) {
  const needle = query.toLowerCase();
  return records.filter((record) =>
    collectSearchText(record).toLowerCase().includes(needle),
  );
}

async function semanticSearchContext(
  args: z.infer<typeof semanticSearchContextSchema>,
) {
  const domains = args.domains?.length
    ? args.domains
    : ([
        "wiki_pages",
        "characters",
        "sessions",
        "evals",
        "docs",
      ] satisfies SemanticSearchDomain[]);
  const limit = args.limit ?? 20;
  const candidates = (
    await Promise.all(
      domains.map((domain) => collectSemanticCandidates(domain, args)),
    )
  ).flat();
  const scored = rankSemanticCandidates(args.query, candidates)
    .slice(0, limit)
    .map((item) => ({
      domain: item.candidate.domain,
      sourceType: item.candidate.sourceType,
      id: item.candidate.id,
      label: item.candidate.label,
      score: item.score,
      excerpt: excerptForQuery(item.candidate.text, args.query),
      metadata: item.candidate.metadata ?? {},
    }));

  return {
    query: args.query,
    domains,
    candidateCount: candidates.length,
    matches: scored,
  };
}

async function collectSemanticCandidates(
  domain: SemanticSearchDomain,
  args: z.infer<typeof semanticSearchContextSchema>,
): Promise<SemanticCandidate[]> {
  switch (domain) {
    case "wiki_pages":
      return collectWikiPageCandidates(args);
    case "characters":
      return collectCharacterCandidates(args);
    case "sessions":
      return collectSessionCandidates(args);
    case "evals":
      return collectEvalCandidates(args);
    case "docs":
      return collectDocCandidates();
    case "tickets":
      return (await getTicketStore().list()).slice(0, 100).map((ticket) => ({
        domain,
        sourceType: "ticket",
        id: ticket.id,
        label: ticket.title,
        text: [
          ticket.title,
          ticket.description,
          ticket.status,
          ticket.domain,
          ticket.priority,
          JSON.stringify(ticket.subtasks ?? ""),
          JSON.stringify(ticket.activity ?? ""),
        ]
          .filter(Boolean)
          .join("\n"),
        metadata: {
          status: ticket.status,
          priority: ticket.priority,
          domain: ticket.domain,
        },
      }));
    case "changelog":
      return (await getChangelogStore().list()).slice(0, 80).map((entry) => ({
        domain,
        sourceType: "changelog_entry",
        id: entry.id,
        label: entry.title,
        text: collectSearchText(entry),
        metadata: { category: entry.category, versionId: entry.versionId },
      }));
  }
}

async function collectWikiPageCandidates(
  args: z.infer<typeof semanticSearchContextSchema>,
) {
  let pages: unknown[] = [];
  if (args.wikiId) {
    pages = await getWikiStore().listPagesForWiki(args.wikiId);
  } else if (args.characterId) {
    const wikis = await getWikisStore().listWikisForCharacter(args.characterId);
    const groups = await Promise.all(
      wikis.slice(0, 10).map((wiki) =>
        getWikiStore()
          .listPagesForWiki(wiki.id)
          .catch(() => []),
      ),
    );
    pages = groups.flat();
  } else {
    pages = await listWikiPageEntities([], 120);
  }

  return pages.map((page) => {
    const record = page as Record<string, unknown>;
    return {
      domain: "wiki_pages" as const,
      sourceType: "wiki_page",
      id: String(record.id),
      label: String(record.title ?? record.slug ?? record.id),
      text: [
        record.title,
        record.summary,
        record.body,
        JSON.stringify(record.frontmatter ?? ""),
        JSON.stringify(record.perspective ?? ""),
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: {
        wikiId: record.wikiId,
        characterId: record.characterId,
        slug: record.slug,
        type: record.type,
        version: record.version,
      },
    };
  });
}

async function collectCharacterCandidates(
  args: z.infer<typeof semanticSearchContextSchema>,
) {
  const characters = args.characterId
    ? [await getCharacterStore().getById(args.characterId)].filter(Boolean)
    : (await getCharacterStore().list()).slice(0, 100);
  return characters.map((character) => ({
    domain: "characters" as const,
    sourceType: "character",
    id: character!.id,
    label: character!.title,
    text: [
      character!.title,
      character!.summary,
      character!.ingestionPrompt,
      JSON.stringify(character!.identity ?? ""),
      JSON.stringify(character!.directive ?? ""),
      JSON.stringify(character!.voiceStyle ?? ""),
      JSON.stringify(character!.brainModel ?? ""),
    ]
      .filter(Boolean)
      .join("\n"),
    metadata: { slug: character!.slug, voiceId: character!.voiceId },
  }));
}

async function collectSessionCandidates(
  args: z.infer<typeof semanticSearchContextSchema>,
) {
  const details = args.sessionIds?.length
    ? await Promise.all(
        args.sessionIds.map((id) =>
          getSceneSessionStore().getSessionDetail(id),
        ),
      )
    : await Promise.all(
        applyEntityFilters(
          await listEntityRecords("world_sessions", [], 100),
          args.characterId
            ? [{ field: "characterId", op: "eq", value: args.characterId }]
            : [],
        )
          .slice(0, 25)
          .map((session) =>
            getSceneSessionStore().getSessionDetail(
              String((session as { id: string }).id),
            ),
          ),
      );

  return details.filter(Boolean).map((detail) => ({
    domain: "sessions" as const,
    sourceType: "world_session",
    id: detail!.session.id,
    label: `${detail!.session.mode} session ${detail!.session.id}`,
    text: [
      JSON.stringify(detail!.session.metadata ?? ""),
      JSON.stringify(detail!.session.currentScene ?? ""),
      ...detail!.turns.flatMap((turn) => [
        turn.userText ?? "",
        turn.assistantText ?? "",
        JSON.stringify(turn.trace ?? ""),
      ]),
      ...detail!.events.map((event) => JSON.stringify(event.payload ?? "")),
    ]
      .filter(Boolean)
      .join("\n"),
    metadata: {
      characterId: detail!.session.characterId,
      sceneId: detail!.session.sceneId,
      status: detail!.session.status,
      turnCount: detail!.turns.length,
    },
  }));
}

async function collectEvalCandidates(
  args: z.infer<typeof semanticSearchContextSchema>,
) {
  if (!args.characterId) return [];
  const store = getEvalStore();
  const [suites, runs, sweeps] = await Promise.all([
    store.listSuites(args.characterId),
    store.listRuns({ characterId: args.characterId, limit: 30 }),
    store.listSweeps(args.characterId),
  ]);
  return [
    ...suites.map((suite) => ({
      domain: "evals" as const,
      sourceType: "eval_suite",
      id: suite.id,
      label: suite.slug,
      text: collectSearchText(suite),
      metadata: {
        characterId: suite.characterId,
        slug: suite.slug,
        version: suite.version,
      },
    })),
    ...runs.map((run) => ({
      domain: "evals" as const,
      sourceType: "eval_run",
      id: run.id,
      label: `Eval run ${run.id}`,
      text: collectSearchText(run),
      metadata: {
        characterId: run.characterId,
        status: run.status,
        suiteId: run.suiteId,
      },
    })),
    ...sweeps.map((sweep) => ({
      domain: "evals" as const,
      sourceType: "eval_sweep",
      id: sweep.id,
      label: `Eval sweep ${sweep.id}`,
      text: collectSearchText(sweep),
      metadata: {
        characterId: sweep.characterId,
        status: sweep.status,
        suiteId: sweep.suiteId,
      },
    })),
  ];
}

async function collectDocCandidates() {
  const listed = await listProjectFiles({
    globs: [
      "README.md",
      "docs/**/*.md",
      "docs/**/*.mdx",
      "apps/admin/src/lib/admin-agent/*.ts",
    ],
    limit: 80,
  });
  const reads = await Promise.all(
    listed.files
      .slice(0, 40)
      .map((file) =>
        readSourceFile({ filePath: file.path, maxChars: 12_000 }).catch(
          () => null,
        ),
      ),
  );
  return reads.filter(Boolean).map((file) => ({
    domain: "docs" as const,
    sourceType: "project_doc",
    id: file!.path,
    label: file!.path,
    text: file!.content,
    metadata: { path: file!.path, modifiedAt: file!.modifiedAt },
  }));
}

function rankSemanticCandidates(
  query: string,
  candidates: SemanticCandidate[],
) {
  const tokens = tokenize(query);
  const phrase = normalizeText(query);
  return candidates
    .map((candidate) => {
      const haystack = normalizeText(`${candidate.label}\n${candidate.text}`);
      let score = 0;
      if (phrase && haystack.includes(phrase)) score += 8;
      for (const token of tokens) {
        const count = countOccurrences(haystack, token);
        if (count > 0)
          score +=
            Math.min(6, count) *
            (candidate.label.toLowerCase().includes(token) ? 2 : 1);
      }
      return { candidate, score };
    })
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.candidate.label.localeCompare(b.candidate.label),
    );
}

function excerptForQuery(text: string, query: string) {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (!normalizedText) return "";
  const tokens = tokenize(query);
  const lower = normalizedText.toLowerCase();
  const firstHit =
    tokens
      .map((token) => lower.indexOf(token))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, firstHit - 180);
  const end = Math.min(normalizedText.length, firstHit + 420);
  return `${start > 0 ? "..." : ""}${normalizedText.slice(start, end)}${end < normalizedText.length ? "..." : ""}`;
}

function tokenize(value: string) {
  return normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2)
    .slice(0, 24);
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function countOccurrences(text: string, token: string) {
  let count = 0;
  let index = text.indexOf(token);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(token, index + token.length);
  }
  return count;
}

async function traceEntityContext(
  args: z.infer<typeof traceEntityContextSchema>,
) {
  const limit = args.limit ?? 20;
  const include = new Set(
    args.include ?? defaultTraceIncludes(args.entityType),
  );
  const primary = await getEntityRecord(args.entityType, args.id);
  const related: Record<string, unknown> = {};

  if (args.entityType === "characters") {
    const character = primary as {
      id?: string;
      voiceId?: string | null;
    } | null;
    if (include.has("wikis") && character?.id) {
      related.wikis = await getWikisStore().listWikisForCharacter(character.id);
    }
    if (include.has("wikiPages") && character?.id) {
      const wikis = await getWikisStore().listWikisForCharacter(character.id);
      const pageGroups = await Promise.all(
        wikis.slice(0, 8).map(async (wiki) => ({
          wikiId: wiki.id,
          title: wiki.title,
          pages: (await getWikiStore().listPagesForWiki(wiki.id)).slice(
            0,
            limit,
          ),
        })),
      );
      related.wikiPages = pageGroups;
    }
    if (include.has("sessions") && character?.id) {
      related.sessions = applyEntityFilters(
        await listEntityRecords("world_sessions", [], Math.max(limit, 100)),
        [{ field: "characterId", op: "eq", value: character.id }],
      ).slice(0, limit);
    }
    if (include.has("evals") && character?.id) {
      const [suites, runs, sweeps] = await Promise.all([
        getEvalStore().listSuites(character.id),
        getEvalStore().listRuns({ characterId: character.id, limit }),
        getEvalStore().listSweeps(character.id),
      ]);
      related.evals = {
        suites: suites.slice(0, limit),
        runs,
        sweeps: sweeps.slice(0, limit),
      };
    }
    if (include.has("worlds") && character?.id) {
      related.worldCount = await getCharacterStore().countWorldsFor(
        character.id,
      );
    }
    if (include.has("voices") && character?.voiceId) {
      related.voice = await getVoiceStore().getById(character.voiceId);
    }
  }

  if (args.entityType === "wikis") {
    if (include.has("wikiPages")) {
      related.pages = (await getWikiStore().listPagesForWiki(args.id)).slice(
        0,
        limit,
      );
    }
    if (include.has("character")) {
      related.bindings = await getWikisStore().listBindingsForWiki(args.id);
    }
    related.sources = (await getWikisStore().listSourcesForWiki(args.id)).slice(
      0,
      limit,
    );
    related.ingestions = await getWikisStore().listIngestionsForWiki(
      args.id,
      limit,
    );
  }

  if (args.entityType === "world_sessions") {
    const detail = primary as {
      session?: { characterId?: string | null; sceneId?: string | null };
    } | null;
    if (include.has("character") && detail?.session?.characterId) {
      related.character = await getCharacterStore().getById(
        detail.session.characterId,
      );
    }
    if (include.has("wikis") && detail?.session?.characterId) {
      related.wikis = await getWikisStore().listWikisForCharacter(
        detail.session.characterId,
      );
    }
  }

  if (args.entityType === "tickets") {
    const ticket = primary as { featureId?: string | null } | null;
    if (include.has("features") && ticket?.featureId) {
      related.feature = await getFeatureStore().getById(ticket.featureId);
    }
  }

  if (args.entityType === "features") {
    if (include.has("tickets")) {
      related.tickets = await getTicketStore().listByFeature(args.id);
    }
  }

  if (args.entityType === "voices" && include.has("character")) {
    related.characters = applyEntityFilters(
      await listEntityRecords("characters", [], 100),
      [{ field: "voiceId", op: "eq", value: args.id }],
    ).slice(0, limit);
  }

  return {
    entityType: args.entityType,
    id: args.id,
    primary: compact(primary),
    related: compact(related, 20_000),
  };
}

async function analyzeWorldSessions(
  args: z.infer<typeof analyzeSessionsSchema>,
) {
  const limit = args.limit ?? 10;
  const details = args.sessionIds?.length
    ? await Promise.all(
        args.sessionIds.map((id) =>
          getSceneSessionStore().getSessionDetail(id),
        ),
      )
    : await Promise.all(
        applyEntityFilters(
          await listEntityRecords("world_sessions", [], 100),
          args.characterId
            ? [{ field: "characterId", op: "eq", value: args.characterId }]
            : [],
        )
          .slice(0, limit)
          .map((session) =>
            getSceneSessionStore().getSessionDetail(
              String((session as { id: string }).id),
            ),
          ),
      );
  const sessions = details.filter(Boolean);
  const turns = sessions.flatMap((detail) => detail?.turns ?? []);
  const events = sessions.flatMap((detail) => detail?.events ?? []);
  const contextBuilds = sessions.flatMap(
    (detail) => detail?.contextBuilds ?? [],
  );
  const errorEvents = events.filter(
    (event) =>
      /error|fail/i.test(event.type) || /error|fail/i.test(event.source),
  );
  const failedTurns = turns.filter(
    (turn) => !/complete|success|succeed/i.test(turn.status),
  );
  const missingAssistantTurns = turns.filter(
    (turn) => !turn.assistantText?.trim(),
  );
  const citedContextBuilds = contextBuilds.filter(
    (build) => countSelectedPages(build.selectedPages) > 0,
  );
  const criteria = args.criteria?.length
    ? args.criteria
    : [
        "identity consistency",
        "wiki grounding",
        "historical accuracy",
        "conversation quality",
        "latency/errors",
      ];

  const recommendationTargets = [
    missingAssistantTurns.length > 0
      ? "Review failed or empty assistant turns before editing character content."
      : null,
    citedContextBuilds.length < Math.max(1, Math.ceil(contextBuilds.length / 2))
      ? "Wiki retrieval appears sparse; inspect wiki coverage, page summaries, and ingestion bindings."
      : null,
    errorEvents.length > 0
      ? "Investigate backend/session errors before treating all behavior as character-quality problems."
      : null,
    turns.length > 0 && averageAssistantLength(turns) < 160
      ? "Assistant responses are short on average; review directive, identity voice, and response-shaping prompts."
      : null,
  ].filter(Boolean);

  return {
    characterId: args.characterId ?? null,
    criteria,
    sessionCount: sessions.length,
    turnCount: turns.length,
    contextBuildCount: contextBuilds.length,
    citedContextBuildCount: citedContextBuilds.length,
    failedTurnCount: failedTurns.length,
    missingAssistantTurnCount: missingAssistantTurns.length,
    errorEventCount: errorEvents.length,
    averageAssistantChars: averageAssistantLength(turns),
    sessions: sessions.map((detail) => ({
      id: detail?.session.id,
      characterId: detail?.session.characterId,
      sceneId: detail?.session.sceneId,
      mode: detail?.session.mode,
      status: detail?.session.status,
      startedAt: detail?.session.startedAt,
      lastActiveAt: detail?.session.lastActiveAt,
      turnCount: detail?.turns.length ?? 0,
      contextBuildCount: detail?.contextBuilds.length ?? 0,
      errorEventCount: (detail?.events ?? []).filter((event) =>
        /error|fail/i.test(event.type),
      ).length,
    })),
    evidenceSnippets: turns.slice(0, 60).map((turn) => ({
      sessionId: turn.sessionId,
      turnId: turn.id,
      turnIndex: turn.turnIndex,
      status: turn.status,
      userText: truncate(turn.userText ?? "", 600),
      assistantText: truncate(turn.assistantText ?? "", 900),
      selectedPageCount: countSelectedPages(
        contextBuilds.find((build) => build.turnId === turn.id)?.selectedPages,
      ),
      latencySummary: turn.latencySummary,
    })),
    errorEvents: errorEvents.slice(0, 30),
    recommendationTargets,
  };
}

async function resolveAnalyzeSessionArgs(
  args: z.infer<typeof analyzeSessionsSchema>,
  context: AdminAgentContext,
): Promise<z.infer<typeof analyzeSessionsSchema>> {
  if (args.characterId) return args;
  const routeSlug = characterSlugFromRouteContext(context);
  if (!routeSlug) return args;

  const store = getCharacterStore();
  const character =
    (await store.getById(routeSlug)) ?? (await store.getBySlug(routeSlug));
  return character ? { ...args, characterId: character.id } : args;
}

function characterSlugFromRouteContext(context: AdminAgentContext) {
  const params = context.routeContext?.params ?? {};
  const paramSlug =
    params.slug ??
    params.characterSlug ??
    params.characterId ??
    params.id ??
    null;
  if (paramSlug) return paramSlug;

  const pathname = context.routeContext?.pathname ?? "";
  const match = pathname.match(/\/characters\/([^/?#]+)/);
  if (!match?.[1] || match[1] === "new") return null;
  return decodeURIComponent(match[1]);
}

function defaultTraceIncludes(entityType: EntityType) {
  switch (entityType) {
    case "characters":
      return ["wikis", "wikiPages", "sessions", "evals", "worlds", "voices"];
    case "wikis":
      return ["wikiPages", "character"];
    case "world_sessions":
      return ["character", "wikis", "worlds"];
    case "tickets":
      return ["features"];
    case "features":
      return ["tickets"];
    case "worlds":
      return ["worldGraph"];
    case "voices":
      return ["character"];
    default:
      return [];
  }
}

function validateEntityPatch(
  entityType: PatchableEntityType,
  patch: Record<string, unknown>,
) {
  const allowed = new Set(ENTITY_PATCH_FIELDS[entityType]);
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    assertSafeFieldPath(key);
    if (!allowed.has(key)) {
      throw new Error(
        `${key} is not patchable on ${entityType}. Allowed fields: ${Array.from(allowed).join(", ")}.`,
      );
    }
    if (value !== undefined) cleaned[key] = value;
  }
  if (Object.keys(cleaned).length === 0)
    throw new Error("Patch must include at least one allowed field.");
  return cleaned;
}

async function dryRunBatchChildren(
  operations: BatchOperationInput[],
  context: AdminAgentContext,
) {
  return Promise.all(
    operations.map(async (operation) => {
      const preview = await dryRunMutationTool(
        operation.toolName,
        operation.args,
        context,
      );
      if (preview.riskLevel === "destructive") {
        throw new Error(
          `${operation.toolName} cannot be included in a batch because it is destructive.`,
        );
      }
      return {
        toolName: operation.toolName,
        args: operation.args,
        intent: operation.intent?.trim() || preview.intent,
        preview,
      };
    }),
  );
}

function maxRisk(
  risks: AdminAgentDryRunResult["riskLevel"][],
): AdminAgentDryRunResult["riskLevel"] {
  const order: Record<AdminAgentDryRunResult["riskLevel"], number> = {
    low: 0,
    medium: 1,
    high: 2,
    destructive: 3,
  };
  return risks.reduce<AdminAgentDryRunResult["riskLevel"]>(
    (highest, risk) => (order[risk] > order[highest] ? risk : highest),
    "low",
  );
}

async function assertPatchTargetNotStale(
  entityType: PatchableEntityType,
  id: string,
  beforeSnapshot: unknown,
) {
  const before = beforeSnapshot as {
    updatedAt?: unknown;
    version?: unknown;
  } | null;
  if (!before?.updatedAt && before?.version === undefined) return;

  const current = (await getEntityRecord(entityType, id)) as {
    updatedAt?: unknown;
    version?: unknown;
  } | null;
  if (!current) throw new Error(`${entityType} ${id} no longer exists.`);

  if (
    before.updatedAt &&
    current.updatedAt &&
    String(before.updatedAt) !== String(current.updatedAt)
  ) {
    throw new Error(
      `${entityType} ${id} changed after this operation was proposed. Refresh and propose a new patch.`,
    );
  }
  if (
    before.version !== undefined &&
    current.version !== undefined &&
    String(before.version) !== String(current.version)
  ) {
    throw new Error(
      `${entityType} ${id} version changed after this operation was proposed. Refresh and propose a new patch.`,
    );
  }
}

function riskForEntityPatch(
  entityType: PatchableEntityType,
  patch: Record<string, unknown>,
): AdminAgentDryRunResult["riskLevel"] {
  const fields = new Set(Object.keys(patch));
  if (entityType === "wiki_pages" && fields.has("body")) return "high";
  if (
    entityType === "characters" &&
    ["identity", "directive", "brainModel", "voiceStyle"].some((field) =>
      fields.has(field),
    )
  ) {
    return "high";
  }
  if (
    entityType === "voices" &&
    ["providerConfig", "sourcePath", "archivedAt"].some((field) =>
      fields.has(field),
    )
  ) {
    return "high";
  }
  return "medium";
}

async function executeEntityPatch(
  entityType: PatchableEntityType,
  id: string,
  patch: Record<string, unknown>,
  metadata: { rationale: string; adminUserId: string },
) {
  switch (entityType) {
    case "tickets":
      return getTicketStore().update(id, patch as never);
    case "versions":
      return getVersionStore().update(id, patch as never);
    case "features":
      return getFeatureStore().update(id, patch as never);
    case "platform_versions":
      return getPlatformVersionStore().update(id, patch as never);
    case "changelog_entries":
      return getChangelogStore().update(id, patch as never);
    case "characters":
      return getCharacterStore().update(id, patch as never);
    case "wikis":
      return getWikisStore().updateWiki(id, patch as never);
    case "voices":
      return getVoiceStore().update(id, patch as never);
    case "wiki_pages": {
      const existing = await getWikiStore().getPage(id);
      if (!existing) throw new Error(`wiki_pages ${id} not found.`);
      const result = await getWikiStore().savePage({
        characterId: existing.characterId || null,
        wikiId: existing.wikiId,
        type: (patch.type ?? existing.type) as never,
        slug: existing.slug,
        title: String(patch.title ?? existing.title),
        summary: (patch.summary ?? existing.summary) as string | null,
        body: String(patch.body ?? existing.body ?? ""),
        frontmatter: (patch.frontmatter ?? existing.frontmatter) as never,
        perspective: (patch.perspective ?? existing.perspective) as never,
        confidence: Number(patch.confidence ?? existing.confidence),
        timeIndex: (patch.timeIndex ?? existing.timeIndex) as never,
        knowsFuture: Boolean(patch.knowsFuture ?? existing.knowsFuture),
        contradictions: (patch.contradictions ??
          existing.contradictions) as never,
        authorKind: "human",
        authorId: metadata.adminUserId,
        note: `Admin agent patch: ${metadata.rationale}`,
      });
      return result.page;
    }
  }
}

function compactEntityRecord(record: unknown) {
  if (!record || typeof record !== "object") return record;
  const out: Record<string, unknown> = {
    ...(record as Record<string, unknown>),
  };
  for (const field of [
    "body",
    "systemPrompt",
    "promptChunk",
    "assistantText",
    "userText",
    "content",
  ]) {
    if (typeof out[field] === "string")
      out[field] = truncate(out[field], 1_500);
  }
  return out;
}

function entityLabel(record: unknown) {
  if (!record || typeof record !== "object") return "record";
  const value = record as Record<string, unknown>;
  return String(
    value.title ??
      value.name ??
      value.slug ??
      value.email ??
      value.id ??
      "record",
  );
}

function assertSafeFieldPath(field: string) {
  if (
    !/^[A-Za-z0-9_.-]+$/.test(field) ||
    field.includes("__proto__") ||
    field.includes("constructor")
  ) {
    throw new Error(`Unsafe field path: ${field}`);
  }
}

function getPath(record: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, record);
}

function stringFilterValue(filters: EntityFilter[], field: string) {
  const filter = filters.find(
    (item) => item.field === field && item.op === "eq",
  );
  return typeof filter?.value === "string" ? filter.value : undefined;
}

function looseEqual(left: unknown, right: unknown) {
  return String(left ?? "") === String(right ?? "");
}

function collectSearchText(value: unknown, depth = 0): string {
  if (value == null || depth > 3) return "";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 25)
      .map((item) => collectSearchText(item, depth + 1))
      .join(" ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(
        ([key]) =>
          ![
            "embedding",
            "providerConfig",
            "audioMetrics",
            "waveformSummary",
          ].includes(key),
      )
      .slice(0, 60)
      .map(([, item]) => collectSearchText(item, depth + 1))
      .join(" ");
  }
  return "";
}

function countSelectedPages(value: unknown): number {
  if (!value) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.pages)) return record.pages.length;
    if (Array.isArray(record.selectedPages)) return record.selectedPages.length;
    return Object.values(record).reduce<number>(
      (sum, item) => sum + countSelectedPages(item),
      0,
    );
  }
  return 0;
}

function averageAssistantLength(
  turns: Array<{ assistantText?: string | null }>,
) {
  const texts = turns
    .map((turn) => turn.assistantText?.trim() ?? "")
    .filter(Boolean);
  if (texts.length === 0) return 0;
  return Math.round(
    texts.reduce((sum, text) => sum + text.length, 0) / texts.length,
  );
}

function buildCodexIssueBody(args: z.infer<typeof createCodexCodeTaskSchema>) {
  return [
    "## Admin Agent Code Task",
    "",
    args.task,
    "",
    args.context ? "## Context" : "",
    args.context ?? "",
    args.constraints?.length ? "## Constraints" : "",
    ...(args.constraints ?? []).map((item) => `- ${item}`),
    args.acceptanceCriteria?.length ? "## Acceptance Criteria" : "",
    ...(args.acceptanceCriteria ?? []).map((item) => `- ${item}`),
    "",
    "## Workflow",
    "- Codex Web should work in its cloud environment against this repository.",
    "- Create or update a pull request rather than changing deployed code directly.",
    "- Keep the change scoped to this task and run the relevant tests before handing off.",
    "",
    "_Created from the Odyssey admin AI agent._",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function buildCodexIssueComment(
  args: z.infer<typeof createCodexCodeTaskSchema>,
) {
  return [
    "@codex",
    "",
    args.task,
    args.context ? "\nContext:\n" + args.context : "",
    args.constraints?.length
      ? "\nConstraints:\n" +
        args.constraints.map((item) => `- ${item}`).join("\n")
      : "",
    args.acceptanceCriteria?.length
      ? "\nAcceptance criteria:\n" +
        args.acceptanceCriteria.map((item) => `- ${item}`).join("\n")
      : "",
  ]
    .join("\n")
    .trim();
}

function buildCodexIssueFollowup(instructions: string) {
  return `@codex\n\n${instructions.trim()}`;
}

function buildCodexPullRequestComment(
  args: z.infer<typeof requestCodexOnPullRequestSchema>,
) {
  const instructions = args.instructions?.trim();
  if (args.mode === "review") {
    return instructions ? `@codex review\n\n${instructions}` : "@codex review";
  }
  if (args.mode === "fix") {
    return `@codex\n\nPlease address the requested changes on this pull request.${instructions ? `\n\n${instructions}` : ""}`;
  }
  if (!instructions)
    throw new Error("instructions are required for custom Codex PR requests.");
  return `@codex\n\n${instructions}`;
}

function truncate(text: string, maxChars: number) {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...` : text;
}

function cleanNulls<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

export const ADMIN_AGENT_TOOLS: AdminAgentTool[] = [
  ...readTools,
  ...mutationTools.flat(),
];

export const ADMIN_AGENT_TOOL_MAP = new Map(
  ADMIN_AGENT_TOOLS.map((tool) => [tool.name, tool]),
);

export function getToolManifest() {
  return ADMIN_AGENT_TOOLS.map((tool) => ({
    name: tool.name,
    kind: tool.kind,
    description: tool.description,
    inputSchema: zodShapeHint(tool.inputSchema),
  }));
}

export function getAdminAgentToolKind(name: string) {
  return ADMIN_AGENT_TOOL_MAP.get(name)?.kind ?? null;
}

export async function runReadTool(
  name: string,
  args: unknown,
  context: AdminAgentContext,
) {
  const tool = ADMIN_AGENT_TOOL_MAP.get(name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  if (tool.kind !== "read")
    throw new Error(
      `${name} is a mutation tool and must be proposed for approval.`,
    );
  return tool.run(args as never, context);
}

export async function dryRunMutationTool(
  name: string,
  args: unknown,
  context: AdminAgentContext,
) {
  const tool = ADMIN_AGENT_TOOL_MAP.get(name);
  if (!tool) throw new Error(`Unknown operation tool: ${name}`);
  if (tool.kind !== "mutation")
    throw new Error(`${name} is a read tool and cannot create an operation.`);
  return tool.dryRun(args as never, context);
}

export async function executeMutationTool(
  name: string,
  args: unknown,
  operation: AdminAgentOperationRecord,
  context: AdminAgentContext,
) {
  const tool = ADMIN_AGENT_TOOL_MAP.get(name);
  if (!tool) throw new Error(`Unknown operation tool: ${name}`);
  if (tool.kind !== "mutation")
    throw new Error(`${name} is not executable as an operation.`);
  return tool.execute(args as never, operation, context);
}

function zodShapeHint(schema: z.ZodTypeAny): string {
  if (schema instanceof z.ZodObject) {
    return Object.keys(schema.shape).join(", ") || "{}";
  }
  return schema.description ?? "object";
}

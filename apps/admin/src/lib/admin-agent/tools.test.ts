import { afterEach, describe, expect, it, vi } from "vitest";
import { getAdminAgentStore, getTicketStore } from "@odyssey/db";
import { approveAdminAgentOperation, cancelAdminAgentOperation } from "./service";
import {
  dryRunMutationTool,
  executeMutationTool,
  getToolManifest,
  runReadTool,
} from "./tools";
import type { AdminAgentContext } from "./types";

const originalGitHubEnv = {
  token: process.env.ADMIN_AGENT_GITHUB_TOKEN,
  repositories: process.env.ADMIN_AGENT_GITHUB_REPOSITORIES,
  defaultRepository: process.env.ADMIN_AGENT_GITHUB_DEFAULT_REPOSITORY,
};

afterEach(() => {
  restoreEnv("ADMIN_AGENT_GITHUB_TOKEN", originalGitHubEnv.token);
  restoreEnv("ADMIN_AGENT_GITHUB_REPOSITORIES", originalGitHubEnv.repositories);
  restoreEnv("ADMIN_AGENT_GITHUB_DEFAULT_REPOSITORY", originalGitHubEnv.defaultRepository);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function context(conversationId: string): AdminAgentContext {
  return {
    conversationId,
    adminUser: {
      id: "admin-test",
      email: "admin@example.com",
      role: "admin",
    },
    routeContext: { pathname: "/board" },
  };
}

describe("admin agent mutation tools", () => {
  it("rejects malformed destructive operations", async () => {
    await expect(
      dryRunMutationTool("delete_ticket", {}, context("conv-bad-delete")),
    ).rejects.toThrow();
  });

  it("dry-runs ticket creation without executing it", async () => {
    const preview = await dryRunMutationTool(
      "create_ticket",
      { title: "Agent test ticket", status: "backlog", priority: "P3" },
      context("conv-preview"),
    );

    expect(preview.riskLevel).toBe("low");
    expect(preview.affectedRecords).toEqual([]);
    expect(preview.previewDiff).toMatchObject({
      create: {
        table: "tickets",
        values: { title: "Agent test ticket", status: "backlog" },
      },
    });
  });

  it("executes an approved ticket creation once", async () => {
    const store = getAdminAgentStore();
    const conversation = await store.createConversation({
      id: `conv-${crypto.randomUUID()}`,
      adminUserId: "admin-test",
    });
    const ctx = context(conversation.id);
    const args = { title: "Approved agent ticket", status: "backlog" };
    const preview = await dryRunMutationTool("create_ticket", args, ctx);
    const operation = await store.createOperation({
      conversationId: conversation.id,
      toolName: "create_ticket",
      intent: preview.intent,
      riskLevel: preview.riskLevel,
      args,
      affectedRecords: preview.affectedRecords,
      previewDiff: preview.previewDiff,
      proposedByUserId: "admin-test",
    });

    const result = await executeMutationTool("create_ticket", args, operation, ctx);

    expect(result.resultSummary).toMatchObject({
      title: "Approved agent ticket",
    });
    expect(result.afterSnapshot).toMatchObject({
      title: "Approved agent ticket",
      status: "backlog",
    });
  });

  it("exposes broad confirmed mutation coverage in the tool manifest", () => {
    const names = new Set(getToolManifest().map((tool) => tool.name));

    expect(Array.from(names)).toEqual(expect.arrayContaining([
      "create_codex_code_task",
      "request_codex_on_issue",
      "request_codex_on_pull_request",
      "merge_github_pull_request",
      "query_entities",
      "get_entity_detail",
      "search_entities",
      "semantic_search_context",
      "trace_entity_context",
      "analyze_sessions",
      "propose_entity_patch",
      "propose_operation_batch",
      "create_character",
      "update_character",
      "delete_character",
      "create_wiki",
      "update_wiki",
      "delete_wiki",
      "save_wiki_page",
      "purge_wiki_source",
      "create_voice",
      "archive_voice",
      "create_eval_suite",
      "mark_eval_run_errored",
    ]));
  });

  it("dry-runs a Codex Web code task as an approved external side effect", async () => {
    configureGitHubEnv();

    const preview = await dryRunMutationTool(
      "create_codex_code_task",
      {
        repository: "binnyplotkin/odyssey",
        title: "Add admin metric",
        task: "Add an audited admin metric panel with tests.",
        constraints: ["Use the existing admin design system."],
        acceptanceCriteria: ["A PR is opened with passing relevant tests."],
        labels: ["codex"],
      },
      context("conv-codex-task"),
    );

    expect(preview.riskLevel).toBe("high");
    expect(preview.affectedRecords).toEqual([
      { table: "github_issues", id: "binnyplotkin/odyssey:new", label: "Add admin metric" },
    ]);
    expect(JSON.stringify(preview.previewDiff)).toContain("@codex");
  });

  it("rejects Codex delegation to repositories outside the allowlist", async () => {
    configureGitHubEnv();

    await expect(
      dryRunMutationTool(
        "create_codex_code_task",
        {
          repository: "someone/elsewhere",
          title: "Unsafe repo",
          task: "Try to delegate work to a non-allowlisted repository.",
        },
        context("conv-codex-repo"),
      ),
    ).rejects.toThrow(/allowlisted/);
  });

  it("dry-runs PR merges as destructive and revalidated at execution time", async () => {
    configureGitHubEnv();

    const preview = await dryRunMutationTool(
      "merge_github_pull_request",
      {
        repository: "binnyplotkin/odyssey",
        pullNumber: 42,
        mergeMethod: "squash",
        expectedHeadSha: "abcdef1",
      },
      context("conv-pr-merge"),
    );

    expect(preview.riskLevel).toBe("destructive");
    expect(preview.previewDiff).toMatchObject({
      externalSideEffect: "github_pull_request_merge",
      repository: "binnyplotkin/odyssey",
      pullNumber: 42,
      executionChecks: { cleanChecksRequired: true, allowNoChecks: false },
    });
  });

  it("queries allowlisted entities through the generic read tool", async () => {
    const ticket = await getTicketStore().create({
      title: "Generic query test ticket",
      status: "backlog",
      priority: "P2",
    });

    const result = await runReadTool(
      "query_entities",
      {
        entityType: "tickets",
        filters: [{ field: "id", op: "eq", value: ticket.id }],
      },
      context("conv-query-entities"),
    );

    expect(result.summary).toContain("tickets: 1 record");
    expect(result.data).toMatchObject({
      entityType: "tickets",
      count: 1,
    });
  });

  it("ranks semantic context across allowlisted domains", async () => {
    const ticket = await getTicketStore().create({
      title: "Semantic covenant regression",
      description: "Moses forgot the covenant context during sandbox review.",
      status: "backlog",
      priority: "P1",
    });

    const result = await runReadTool(
      "semantic_search_context",
      {
        query: "covenant sandbox review",
        domains: ["tickets"],
        limit: 5,
      },
      context("conv-semantic-search"),
    );

    expect(result.summary).toContain("ranked match");
    expect(result.data).toMatchObject({
      query: "covenant sandbox review",
    });
    const data = result.data as { matches: Array<{ id: string; domain: string; excerpt: string }> };
    expect(data.matches.some((match) => match.id === ticket.id && match.domain === "tickets")).toBe(true);
    expect(data.matches[0].excerpt).toContain("covenant");
  });

  it("dry-runs a generic entity patch with an allowlisted field diff", async () => {
    const ticket = await getTicketStore().create({
      title: "Patch me",
      status: "backlog",
    });

    const preview = await dryRunMutationTool(
      "propose_entity_patch",
      {
        entityType: "tickets",
        id: ticket.id,
        patch: { status: "in-progress" },
        rationale: "The ticket is now actively being worked.",
        evidence: ["Admin requested the status change."],
      },
      context("conv-entity-patch"),
    );

    expect(preview.riskLevel).toBe("medium");
    expect(preview.affectedRecords).toEqual([
      { table: "tickets", id: ticket.id, label: "Patch me" },
    ]);
    expect(preview.previewDiff).toMatchObject({
      patch: { status: "in-progress" },
      afterPreview: { status: "in-progress" },
    });
  });

  it("rejects generic entity patches for non-allowlisted fields", async () => {
    const ticket = await getTicketStore().create({
      title: "Unsafe patch",
      status: "backlog",
    });

    await expect(
      dryRunMutationTool(
        "propose_entity_patch",
        {
          entityType: "tickets",
          id: ticket.id,
          patch: { adminOnlySecret: "nope" },
          rationale: "Should be rejected.",
        },
        context("conv-bad-entity-patch"),
      ),
    ).rejects.toThrow(/not patchable/);
  });

  it("dry-runs and executes a conservative operation batch", async () => {
    const store = getAdminAgentStore();
    const conversation = await store.createConversation({
      id: `conv-${crypto.randomUUID()}`,
      adminUserId: "admin-test",
    });
    const existing = await getTicketStore().create({
      title: "Batch target",
      status: "backlog",
    });
    const args = {
      title: "Close audit follow-ups",
      rationale: "Apply a small set of non-destructive admin improvements.",
      evidence: ["The audit identified one active ticket and one new follow-up."],
      operations: [
        {
          toolName: "propose_entity_patch",
          intent: "Move the existing ticket into progress",
          args: {
            entityType: "tickets",
            id: existing.id,
            patch: { status: "in-progress" },
            rationale: "The work has started.",
          },
        },
        {
          toolName: "create_ticket",
          intent: "Create a follow-up ticket",
          args: {
            title: "Review character audit report",
            status: "backlog",
            priority: "P2",
          },
        },
      ],
    };

    const preview = await dryRunMutationTool("propose_operation_batch", args, context(conversation.id));
    expect(preview.riskLevel).toBe("medium");
    expect(preview.previewDiff).toMatchObject({
      kind: "operation_batch",
      title: "Close audit follow-ups",
      operations: [
        { toolName: "propose_entity_patch" },
        { toolName: "create_ticket" },
      ],
    });

    const operation = await store.createOperation({
      conversationId: conversation.id,
      toolName: "propose_operation_batch",
      intent: preview.intent,
      riskLevel: preview.riskLevel,
      args,
      affectedRecords: preview.affectedRecords,
      previewDiff: preview.previewDiff,
      beforeSnapshot: preview.beforeSnapshot ?? null,
      proposedByUserId: "admin-test",
    });
    const result = await executeMutationTool("propose_operation_batch", args, operation, context(conversation.id));

    expect(result.resultSummary).toMatchObject({
      action: "operation_batch_completed",
      completedCount: 2,
    });
    await expect(getTicketStore().getById(existing.id)).resolves.toMatchObject({
      status: "in-progress",
    });
  });

  it("rejects unsupported tools in operation batches", async () => {
    await expect(
      dryRunMutationTool(
        "propose_operation_batch",
        {
          title: "Unsafe batch",
          rationale: "Should not allow destructive tools.",
          operations: [
            {
              toolName: "delete_ticket",
              args: { id: "ticket-id" },
            },
          ],
        },
        context("conv-bad-batch"),
      ),
    ).rejects.toThrow();
  });

  it("rejects stale generic entity patches at execution time", async () => {
    const store = getAdminAgentStore();
    const conversation = await store.createConversation({
      id: `conv-${crypto.randomUUID()}`,
      adminUserId: "admin-test",
    });
    const ticket = await getTicketStore().create({
      title: "Stale patch target",
      status: "backlog",
    });
    const args = {
      entityType: "tickets",
      id: ticket.id,
      patch: { status: "done" },
      rationale: "Close it out.",
    };
    const preview = await dryRunMutationTool("propose_entity_patch", args, context(conversation.id));
    const operation = await store.createOperation({
      conversationId: conversation.id,
      toolName: "propose_entity_patch",
      intent: preview.intent,
      riskLevel: preview.riskLevel,
      args,
      affectedRecords: preview.affectedRecords,
      previewDiff: preview.previewDiff,
      beforeSnapshot: { ...ticket, updatedAt: "2000-01-01T00:00:00.000Z" },
      proposedByUserId: "admin-test",
    });

    await expect(
      executeMutationTool("propose_entity_patch", args, operation, context(conversation.id)),
    ).rejects.toThrow(/changed after this operation was proposed/);
  });

  it("executes Codex task GitHub issue and comment calls after approval", async () => {
    configureGitHubEnv();
    const store = getAdminAgentStore();
    const conversation = await store.createConversation({
      id: `conv-${crypto.randomUUID()}`,
      adminUserId: "admin-test",
    });
    const args = {
      repository: "binnyplotkin/odyssey",
      title: "Mock Codex task",
      task: "Implement the mocked Codex task with tests.",
      labels: ["codex"],
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/issues") && init?.method === "POST") {
        return Response.json({
          number: 123,
          title: "Mock Codex task",
          state: "open",
          html_url: "https://github.com/binnyplotkin/odyssey/issues/123",
          labels: [{ name: "codex" }],
        });
      }
      if (String(url).endsWith("/issues/123/comments") && init?.method === "POST") {
        return Response.json({
          id: 456,
          html_url: "https://github.com/binnyplotkin/odyssey/issues/123#issuecomment-456",
        });
      }
      return Response.json({ message: "not found" }, { status: 404 });
    }));

    const preview = await dryRunMutationTool("create_codex_code_task", args, context(conversation.id));
    const operation = await store.createOperation({
      conversationId: conversation.id,
      toolName: "create_codex_code_task",
      intent: preview.intent,
      riskLevel: preview.riskLevel,
      args,
      affectedRecords: preview.affectedRecords,
      previewDiff: preview.previewDiff,
      beforeSnapshot: preview.beforeSnapshot ?? null,
      proposedByUserId: "admin-test",
    });

    const result = await executeMutationTool("create_codex_code_task", args, operation, context(conversation.id));

    expect(result.resultSummary).toMatchObject({
      repository: "binnyplotkin/odyssey",
      issueNumber: 123,
      codexCommentUrl: "https://github.com/binnyplotkin/odyssey/issues/123#issuecomment-456",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("admin agent operation approvals", () => {
  it("cancels a pending operation and prevents later approval", async () => {
    const store = getAdminAgentStore();
    const conversation = await store.createConversation({
      id: `conv-${crypto.randomUUID()}`,
      adminUserId: "admin-test",
    });
    const args = { title: "Do not create", status: "backlog" };
    const preview = await dryRunMutationTool("create_ticket", args, context(conversation.id));
    const operation = await store.createOperation({
      conversationId: conversation.id,
      toolName: "create_ticket",
      intent: preview.intent,
      riskLevel: preview.riskLevel,
      args,
      affectedRecords: preview.affectedRecords,
      previewDiff: preview.previewDiff,
      proposedByUserId: "admin-test",
    });

    const cancelled = await cancelAdminAgentOperation({
      operationId: operation.id,
      adminUser: context(conversation.id).adminUser,
      reason: "Not needed.",
    });

    expect(cancelled.status).toBe("cancelled");
    await expect(
      approveAdminAgentOperation({
        operationId: operation.id,
        adminUser: context(conversation.id).adminUser,
      }),
    ).rejects.toThrow(/only pending operations can be approved/);
  });

  it("refuses approval from a different admin conversation owner", async () => {
    const store = getAdminAgentStore();
    const conversation = await store.createConversation({
      id: `conv-${crypto.randomUUID()}`,
      adminUserId: "admin-owner",
    });
    const args = { title: "Owner-only operation", status: "backlog" };
    const preview = await dryRunMutationTool("create_ticket", args, {
      ...context(conversation.id),
      adminUser: { id: "admin-owner", email: "owner@example.com", role: "admin" },
    });
    const operation = await store.createOperation({
      conversationId: conversation.id,
      toolName: "create_ticket",
      intent: preview.intent,
      riskLevel: preview.riskLevel,
      args,
      affectedRecords: preview.affectedRecords,
      previewDiff: preview.previewDiff,
      proposedByUserId: "admin-owner",
    });

    await expect(
      approveAdminAgentOperation({
        operationId: operation.id,
        adminUser: { id: "other-admin", email: "other@example.com", role: "admin" },
      }),
    ).rejects.toThrow(/does not belong/);
  });
});

describe("admin agent conversation context", () => {
  it("persists durable context summaries with conversation detail", async () => {
    const store = getAdminAgentStore();
    const conversation = await store.createConversation({
      id: `conv-${crypto.randomUUID()}`,
      adminUserId: "admin-test",
    });
    const message = await store.appendMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "We decided to audit sandbox sessions before wiki edits.",
    });

    const summary = await store.createContextSummary({
      conversationId: conversation.id,
      summary: "Admin wants sandbox session audits before proposing wiki or character identity edits.",
      sourceMessageCount: 1,
      lastMessageId: message.id,
      model: "test-model",
      provider: "test-provider",
      metadata: { kind: "test" },
    });

    await expect(store.getLatestContextSummary(conversation.id)).resolves.toMatchObject({
      id: summary.id,
      conversationId: conversation.id,
      sourceMessageCount: 1,
    });
    await expect(store.getConversationDetail(conversation.id)).resolves.toMatchObject({
      contextSummaries: [
        {
          id: summary.id,
          summary: expect.stringContaining("sandbox session audits"),
        },
      ],
    });
  });
});

describe("admin agent session analysis", () => {
  it("accepts nullable optional args and overstructured criteria", async () => {
    const result = await runReadTool(
      "analyze_sessions",
      {
        characterId: null,
        criteria: [
          { type: "limit", value: 10 },
          { type: "order", value: "desc", by: "createdAt" },
        ],
      },
      context("conv-session-analysis"),
    );

    expect(result.summary).toContain("Analyzed");
    expect(result.data).toMatchObject({
      characterId: null,
      criteria: [
        "{\"type\":\"limit\",\"value\":10}",
        "{\"type\":\"order\",\"value\":\"desc\",\"by\":\"createdAt\"}",
      ],
    });
  });

  it("accepts criteria passed as a single string", async () => {
    const result = await runReadTool(
      "analyze_sessions",
      {
        characterId: null,
        criteria: "identity consistency, wiki grounding, latency/errors",
      },
      context("conv-session-analysis-criteria-string"),
    );

    expect(result.summary).toContain("Analyzed");
    expect(result.data).toMatchObject({
      characterId: null,
      criteria: [
        "identity consistency",
        "wiki grounding",
        "latency/errors",
      ],
    });
  });
});

describe("admin agent codebase read tools", () => {
  it("reads an allowed source file with truncation metadata", async () => {
    const result = await runReadTool(
      "read_source_file",
      { path: "apps/admin/src/lib/admin-agent/codebase.ts", maxChars: 2_000 },
      context("conv-code-read"),
    );

    expect(result.summary).toContain("apps/admin/src/lib/admin-agent/codebase.ts");
    expect(result.data).toMatchObject({
      path: "apps/admin/src/lib/admin-agent/codebase.ts",
    });
    expect(String((result.data as { content: string }).content)).toContain("getProjectRoot");
  });

  it("rejects path traversal and env reads", async () => {
    await expect(
      runReadTool("read_source_file", { path: "../../.env" }, context("conv-code-traversal")),
    ).rejects.toThrow();

    await expect(
      runReadTool("read_source_file", { path: ".env.example" }, context("conv-code-env")),
    ).rejects.toThrow(/safety policy/);
  });

  it("searches readable code with result caps", async () => {
    const result = await runReadTool(
      "search_code",
      {
        query: "export const ADMIN_AGENT_TOOLS",
        globs: ["apps/admin/src/lib/admin-agent/*.ts"],
        limit: 5,
      },
      context("conv-code-search"),
    );

    const data = result.data as { matches: Array<{ path: string; line: number; text: string }> };
    expect(data.matches.length).toBeGreaterThan(0);
    expect(data.matches.some((match) => match.path === "apps/admin/src/lib/admin-agent/tools.ts")).toBe(true);
  });

  it("normalizes common admin-app source globs for code searches", async () => {
    const result = await runReadTool(
      "search_code",
      {
        query: "sandbox",
        globs: ["src/app/**/*"],
        limit: 5,
      },
      context("conv-code-glob-alias"),
    );

    const data = result.data as { scannedFiles: number; matches: Array<{ path: string }> };
    expect(data.scannedFiles).toBeGreaterThan(0);
    expect(data.matches.some((match) => match.path.includes("/characters/[slug]/sandbox/"))).toBe(true);
  });

  it("inspects admin route source for a pathname", async () => {
    const result = await runReadTool(
      "inspect_route_source",
      { pathname: "/characters/test-slug", maxCharsPerFile: 2_000 },
      context("conv-route-source"),
    );

    const data = result.data as { files: Array<{ path: string; kind: string }> };
    expect(data.files.some((file) => file.path.endsWith("characters/[slug]/page.tsx"))).toBe(true);
  });
});

function configureGitHubEnv() {
  process.env.ADMIN_AGENT_GITHUB_TOKEN = "test-token";
  process.env.ADMIN_AGENT_GITHUB_REPOSITORIES = "binnyplotkin/odyssey";
  process.env.ADMIN_AGENT_GITHUB_DEFAULT_REPOSITORY = "binnyplotkin/odyssey";
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

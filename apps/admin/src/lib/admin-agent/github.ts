export type GitHubRepository = {
  owner: string;
  repo: string;
  fullName: string;
};

export type GitHubIssue = {
  number: number;
  title: string;
  state: string;
  html_url: string;
  labels?: Array<{ name?: string } | string>;
};

export type GitHubPullRequest = {
  number: number;
  title: string;
  state: string;
  draft?: boolean;
  html_url: string;
  mergeable?: boolean | null;
  mergeable_state?: string;
  head: {
    sha: string;
    ref: string;
    repo?: { full_name?: string | null } | null;
  };
  base: {
    ref: string;
    repo?: { full_name?: string | null } | null;
  };
};

export type GitHubPullRequestReadiness = {
  repository: string;
  pullRequest: GitHubPullRequest;
  combinedStatus: string;
  statusCount: number;
  checkRunCount: number;
  checkConclusionSummary: Record<string, number>;
  isMergeableByPolicy: boolean;
  blockers: string[];
};

const GITHUB_API_BASE = "https://api.github.com";

export function resolveGitHubRepository(input?: string): GitHubRepository {
  const configured = getAllowedRepositories();
  const selected = input?.trim() || getDefaultRepository();
  if (!selected) {
    throw new Error("No GitHub repository configured. Set ADMIN_AGENT_GITHUB_DEFAULT_REPOSITORY or ADMIN_AGENT_GITHUB_REPOSITORIES.");
  }
  if (!configured.has(selected)) {
    throw new Error(`Repository ${selected} is not allowlisted for admin-agent GitHub operations.`);
  }
  const [owner, repo] = selected.split("/");
  if (!owner || !repo) throw new Error(`Invalid GitHub repository: ${selected}`);
  return { owner, repo, fullName: selected };
}

export function getConfiguredRepositoryNames() {
  return Array.from(getAllowedRepositories());
}

export async function createGitHubIssue(input: {
  repository?: string;
  title: string;
  body: string;
  labels?: string[];
}) {
  const repository = resolveGitHubRepository(input.repository);
  const issue = await githubRequest<GitHubIssue>({
    repository,
    method: "POST",
    path: "/issues",
    body: {
      title: input.title,
      body: input.body,
      labels: input.labels?.length ? input.labels : undefined,
    },
  });
  return { repository, issue };
}

export async function createGitHubIssueComment(input: {
  repository?: string;
  issueNumber: number;
  body: string;
}) {
  const repository = resolveGitHubRepository(input.repository);
  const comment = await githubRequest<{ id: number; html_url: string; body?: string }>({
    repository,
    method: "POST",
    path: `/issues/${input.issueNumber}/comments`,
    body: { body: input.body },
  });
  return { repository, comment };
}

export async function getGitHubIssue(input: {
  repository?: string;
  issueNumber: number;
}) {
  const repository = resolveGitHubRepository(input.repository);
  const issue = await githubRequest<GitHubIssue>({
    repository,
    method: "GET",
    path: `/issues/${input.issueNumber}`,
  });
  return { repository, issue };
}

export async function getGitHubPullRequest(input: {
  repository?: string;
  pullNumber: number;
}) {
  const repository = resolveGitHubRepository(input.repository);
  const pullRequest = await githubRequest<GitHubPullRequest>({
    repository,
    method: "GET",
    path: `/pulls/${input.pullNumber}`,
  });
  return { repository, pullRequest };
}

export async function getGitHubPullRequestReadiness(input: {
  repository?: string;
  pullNumber: number;
  requireCleanChecks?: boolean;
  allowNoChecks?: boolean;
  expectedHeadSha?: string;
}): Promise<GitHubPullRequestReadiness> {
  const { repository, pullRequest } = await getGitHubPullRequest(input);
  const [combinedStatus, checkRuns] = await Promise.all([
    githubRequest<{ state: string; total_count: number }>({
      repository,
      method: "GET",
      path: `/commits/${pullRequest.head.sha}/status`,
    }),
    githubRequest<{ total_count: number; check_runs: Array<{ status: string; conclusion: string | null; name: string }> }>({
      repository,
      method: "GET",
      path: `/commits/${pullRequest.head.sha}/check-runs`,
    }),
  ]);

  const blockers: string[] = [];
  if (pullRequest.state !== "open") blockers.push(`PR is ${pullRequest.state}.`);
  if (pullRequest.draft) blockers.push("PR is still marked as draft.");
  if (input.expectedHeadSha && input.expectedHeadSha !== pullRequest.head.sha) {
    blockers.push(`Head SHA changed from ${input.expectedHeadSha} to ${pullRequest.head.sha}.`);
  }
  if (pullRequest.mergeable === false) blockers.push("GitHub reports the PR is not mergeable.");

  const statusCount = combinedStatus.total_count ?? 0;
  const checkRunCount = checkRuns.total_count ?? checkRuns.check_runs?.length ?? 0;
  const hasAnyChecks = statusCount > 0 || checkRunCount > 0;
  const requireCleanChecks = input.requireCleanChecks ?? true;

  if (requireCleanChecks && !hasAnyChecks && !input.allowNoChecks) {
    blockers.push("No GitHub statuses or check runs were found.");
  }
  if (requireCleanChecks && statusCount > 0 && combinedStatus.state !== "success") {
    blockers.push(`Combined commit status is ${combinedStatus.state}.`);
  }

  const checkConclusionSummary: Record<string, number> = {};
  for (const run of checkRuns.check_runs ?? []) {
    const key = run.status === "completed" ? run.conclusion ?? "unknown" : run.status;
    checkConclusionSummary[key] = (checkConclusionSummary[key] ?? 0) + 1;
    if (requireCleanChecks && !["success", "neutral", "skipped"].includes(key)) {
      blockers.push(`Check run "${run.name}" is ${key}.`);
    }
  }

  return {
    repository: repository.fullName,
    pullRequest,
    combinedStatus: combinedStatus.state,
    statusCount,
    checkRunCount,
    checkConclusionSummary,
    isMergeableByPolicy: blockers.length === 0,
    blockers,
  };
}

export async function mergeGitHubPullRequest(input: {
  repository?: string;
  pullNumber: number;
  mergeMethod: "merge" | "squash" | "rebase";
  expectedHeadSha?: string;
  commitTitle?: string;
  commitMessage?: string;
}) {
  const repository = resolveGitHubRepository(input.repository);
  return githubRequest<{
    sha: string;
    merged: boolean;
    message: string;
  }>({
    repository,
    method: "PUT",
    path: `/pulls/${input.pullNumber}/merge`,
    body: {
      merge_method: input.mergeMethod,
      sha: input.expectedHeadSha,
      commit_title: input.commitTitle,
      commit_message: input.commitMessage,
    },
  });
}

function getDefaultRepository() {
  return (
    process.env.ADMIN_AGENT_GITHUB_DEFAULT_REPOSITORY?.trim() ||
    firstCsv(process.env.ADMIN_AGENT_GITHUB_REPOSITORIES) ||
    process.env.GITHUB_REPOSITORY?.trim() ||
    ""
  );
}

function getAllowedRepositories() {
  const configured = [
    ...csv(process.env.ADMIN_AGENT_GITHUB_REPOSITORIES),
    process.env.ADMIN_AGENT_GITHUB_DEFAULT_REPOSITORY?.trim(),
    process.env.GITHUB_REPOSITORY?.trim(),
  ].filter(Boolean) as string[];
  return new Set(configured);
}

function requireGitHubToken() {
  const token = process.env.ADMIN_AGENT_GITHUB_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new Error("GitHub operations require ADMIN_AGENT_GITHUB_TOKEN or GITHUB_TOKEN.");
  }
  return token;
}

async function githubRequest<T>(input: {
  repository: GitHubRepository;
  method: "GET" | "POST" | "PUT";
  path: string;
  body?: unknown;
}): Promise<T> {
  const token = requireGitHubToken();
  const response = await fetch(`${GITHUB_API_BASE}/repos/${input.repository.owner}/${input.repository.repo}${input.path}`, {
    method: input.method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });

  if (!response.ok) {
    const message = await safeErrorMessage(response);
    throw new Error(`GitHub ${input.method} ${input.path} failed (${response.status}): ${message}`);
  }

  return response.json() as Promise<T>;
}

async function safeErrorMessage(response: Response) {
  try {
    const data = await response.json() as { message?: string };
    return data.message || response.statusText;
  } catch {
    return response.statusText;
  }
}

function csv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstCsv(value: string | undefined) {
  return csv(value)[0] ?? "";
}

import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_READ_CHARS = 20_000;
const MAX_READ_CHARS = 50_000;
const DEFAULT_SEARCH_LIMIT = 40;
const MAX_SEARCH_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 500;
const MAX_SEARCH_FILE_BYTES = 750_000;
const MAX_SEARCH_LINE_CHARS = 500;

const DENIED_SEGMENTS = new Set([
  ".cache",
  ".git",
  ".next",
  ".next-agent",
  ".next-preview",
  ".output",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

const DENIED_EXTENSIONS = new Set([
  ".cer",
  ".crt",
  ".der",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".key",
  ".mov",
  ".mp3",
  ".mp4",
  ".otf",
  ".p12",
  ".pem",
  ".pfx",
  ".png",
  ".safetensors",
  ".sqlite",
  ".ttf",
  ".wav",
  ".webp",
  ".woff",
  ".woff2",
]);

const TEXT_LIKE_EXTENSIONS = new Set([
  "",
  ".cjs",
  ".css",
  ".csv",
  ".graphql",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".lock",
  ".md",
  ".mdx",
  ".mjs",
  ".mts",
  ".scss",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

export type ProjectFileSummary = {
  path: string;
  size: number;
  modifiedAt: string;
};

export type SourceFileRead = ProjectFileSummary & {
  content: string;
  truncated: boolean;
};

export type CodeSearchMatch = {
  path: string;
  line: number;
  text: string;
};

export async function getProjectRoot() {
  let current = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (await isProjectRoot(current)) {
      return fs.realpath(current);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return fs.realpath(process.cwd());
}

export async function listProjectFiles(input: {
  globs?: string[];
  limit?: number;
}) {
  const root = await getProjectRoot();
  const limit = clamp(input.limit ?? DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
  const matchers = buildMatchers(input.globs);
  const files: ProjectFileSummary[] = [];

  for await (const file of walkProjectFiles(root)) {
    if (!matches(matchers, file.path)) continue;
    files.push(file);
    if (files.length >= limit) break;
  }

  return {
    root,
    count: files.length,
    truncated: files.length >= limit,
    files,
  };
}

export async function readSourceFile(input: {
  filePath: string;
  maxChars?: number;
}): Promise<SourceFileRead> {
  const root = await getProjectRoot();
  const resolved = await resolveAllowedProjectPath(root, input.filePath);
  const stat = await fs.stat(resolved.absolutePath);
  if (!stat.isFile()) {
    throw new Error(`${resolved.relativePath} is not a file.`);
  }
  assertTextLike(resolved.relativePath);

  const maxChars = clamp(input.maxChars ?? DEFAULT_READ_CHARS, 1_000, MAX_READ_CHARS);
  const content = await fs.readFile(resolved.absolutePath, "utf8");

  return {
    path: resolved.relativePath,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    content: content.length > maxChars ? content.slice(0, maxChars) : content,
    truncated: content.length > maxChars,
  };
}

export async function searchCode(input: {
  query: string;
  globs?: string[];
  limit?: number;
  maxFileBytes?: number;
}) {
  const root = await getProjectRoot();
  const query = input.query.trim();
  if (query.length < 2) throw new Error("Search query must be at least 2 characters.");

  const limit = clamp(input.limit ?? DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT);
  const maxFileBytes = clamp(input.maxFileBytes ?? MAX_SEARCH_FILE_BYTES, 8_000, MAX_SEARCH_FILE_BYTES);
  const matchers = buildMatchers(input.globs);
  const matchesOut: CodeSearchMatch[] = [];
  const needle = query.toLowerCase();
  let scannedFiles = 0;
  let skippedLargeFiles = 0;

  for await (const file of walkProjectFiles(root)) {
    if (!matches(matchers, file.path)) continue;
    if (!isTextLike(file.path)) continue;
    if (file.size > maxFileBytes) {
      skippedLargeFiles += 1;
      continue;
    }

    scannedFiles += 1;
    const content = await fs.readFile(path.join(root, file.path), "utf8");
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].toLowerCase().includes(needle)) continue;
      matchesOut.push({
        path: file.path,
        line: index + 1,
        text: lines[index].trim().slice(0, MAX_SEARCH_LINE_CHARS),
      });
      if (matchesOut.length >= limit) {
        return {
          root,
          query,
          scannedFiles,
          skippedLargeFiles,
          truncated: true,
          matches: matchesOut,
        };
      }
    }
  }

  if (scannedFiles === 0 && input.globs?.length) {
    return searchCode({ ...input, globs: undefined });
  }

  return {
    root,
    query,
    scannedFiles,
    skippedLargeFiles,
    truncated: false,
    matches: matchesOut,
  };
}

export async function inspectRouteSource(input: {
  pathname: string;
  maxCharsPerFile?: number;
}) {
  const root = await getProjectRoot();
  const pathname = normalizeRoutePath(input.pathname);
  const maxCharsPerFile = clamp(input.maxCharsPerFile ?? 10_000, 1_000, 25_000);
  const candidates: Array<{
    path: string;
    kind: "layout" | "page" | "route";
    routePattern: string;
    content: string;
    truncated: boolean;
  }> = [];

  for await (const file of walkProjectFiles(root)) {
    if (!file.path.startsWith("apps/admin/src/app/")) continue;
    const basename = path.posix.basename(file.path);
    if (basename !== "layout.tsx" && basename !== "page.tsx" && basename !== "route.ts") {
      continue;
    }

    const routePattern = routePatternForAppFile(file.path);
    if (!routePattern) continue;

    const kind = basename === "layout.tsx" ? "layout" : basename === "page.tsx" ? "page" : "route";
    const isMatch = kind === "layout"
      ? routeContainsPath(routePattern, pathname)
      : routeMatchesPath(routePattern, pathname);
    if (!isMatch) continue;

    const read = await readSourceFile({ filePath: file.path, maxChars: maxCharsPerFile });
    candidates.push({
      path: read.path,
      kind,
      routePattern,
      content: read.content,
      truncated: read.truncated,
    });
  }

  candidates.sort((a, b) => {
    if (a.kind === b.kind) return a.path.localeCompare(b.path);
    return kindRank(a.kind) - kindRank(b.kind);
  });

  return {
    root,
    pathname,
    count: candidates.length,
    files: candidates.slice(0, 8),
    truncated: candidates.length > 8,
  };
}

async function isProjectRoot(dir: string) {
  try {
    const [packageJson, apps, packages] = await Promise.all([
      fs.readFile(path.join(dir, "package.json"), "utf8"),
      fs.stat(path.join(dir, "apps")),
      fs.stat(path.join(dir, "packages")),
    ]);
    return packageJson.includes('"name": "odyssey"') && apps.isDirectory() && packages.isDirectory();
  } catch {
    return false;
  }
}

async function resolveAllowedProjectPath(root: string, requestedPath: string) {
  const trimmed = requestedPath.trim();
  const absolutePath = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(root, trimmed.replace(/^[/\\]+/, ""));

  let realPath: string;
  try {
    realPath = await fs.realpath(absolutePath);
  } catch (error) {
    throw new Error(`File not found: ${requestedPath}`);
  }

  const relativePath = toPosix(path.relative(root, realPath));
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Requested path is outside the project root.");
  }
  assertAllowedRelativePath(relativePath);
  return { absolutePath: realPath, relativePath };
}

async function* walkProjectFiles(root: string, dir = root): AsyncGenerator<ProjectFileSummary> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    const relative = toPosix(path.relative(root, absolute));
    if (!relative || isDeniedRelativePath(relative)) continue;
    if (entry.isSymbolicLink()) continue;

    if (entry.isDirectory()) {
      yield* walkProjectFiles(root, absolute);
      continue;
    }

    if (!entry.isFile()) continue;
    const stat = await fs.stat(absolute);
    yield {
      path: relative,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    };
  }
}

function assertAllowedRelativePath(relativePath: string) {
  if (isDeniedRelativePath(relativePath)) {
    throw new Error(`Access to ${relativePath} is blocked by the admin-agent codebase safety policy.`);
  }
}

function isDeniedRelativePath(relativePath: string) {
  const segments = relativePath.split("/");
  if (segments.some((segment) => DENIED_SEGMENTS.has(segment))) return true;
  if (segments.some((segment) => segment === ".env" || segment.startsWith(".env."))) return true;
  if (segments.some((segment) => segment === "id_rsa" || segment === "id_ed25519")) return true;
  return DENIED_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase());
}

function assertTextLike(relativePath: string) {
  if (!isTextLike(relativePath)) {
    throw new Error(`Refusing to read non-text file: ${relativePath}`);
  }
}

function isTextLike(relativePath: string) {
  return TEXT_LIKE_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase());
}

function buildMatchers(globs: string[] | undefined) {
  return expandGlobAliases(globs ?? [])
    .map((glob) => glob.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map(globToRegExp);
}

function expandGlobAliases(globs: string[]) {
  const expanded = new Set<string>();
  for (const glob of globs) {
    for (const normalized of normalizeGlob(glob)) {
      expanded.add(normalized);
      if (normalized.startsWith("src/")) {
        expanded.add(`apps/admin/${normalized}`);
      } else if (
        normalized.startsWith("app/") ||
        normalized.startsWith("components/") ||
        normalized.startsWith("lib/")
      ) {
        expanded.add(`apps/admin/src/${normalized}`);
      }
    }
  }
  return Array.from(expanded);
}

function normalizeGlob(glob: string) {
  const normalized = toPosix(glob)
    .trim()
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
  if (!normalized) return [];
  if (normalized.includes("*") || path.posix.extname(normalized)) return [normalized];
  return [normalized, `${normalized.replace(/\/$/, "")}/**/*`];
}

function matches(matchers: RegExp[], relativePath: string) {
  return matchers.length === 0 || matchers.some((matcher) => matcher.test(relativePath));
}

function globToRegExp(glob: string) {
  const normalized = toPosix(glob).replace(/^\/+/, "");
  let source = "";
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      i += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(char);
    }
  }
  const anchored = normalized.includes("/") ? `^${source}$` : `(^|/)${source}$`;
  return new RegExp(anchored);
}

function routePatternForAppFile(relativePath: string) {
  const appPrefix = "apps/admin/src/app/";
  if (!relativePath.startsWith(appPrefix)) return null;
  const withoutPrefix = relativePath.slice(appPrefix.length);
  const dir = path.posix.dirname(withoutPrefix);
  const segments = dir === "." ? [] : dir.split("/");
  const routeSegments = segments.filter((segment) => !segment.startsWith("(") || !segment.endsWith(")"));
  return `/${routeSegments.join("/")}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function routeMatchesPath(routePattern: string, pathname: string) {
  return routePatternToRegExp(routePattern, true).test(pathname);
}

function routeContainsPath(routePattern: string, pathname: string) {
  if (routePattern === "/") return true;
  return routePatternToRegExp(routePattern, false).test(pathname);
}

function routePatternToRegExp(routePattern: string, exact: boolean) {
  const segments = routePattern.split("/").filter(Boolean);
  const source = segments.map((segment) => {
    if (segment.startsWith("[[...") && segment.endsWith("]]")) return "(?:.*)?";
    if (segment.startsWith("[...") && segment.endsWith("]")) return ".+";
    if (segment.startsWith("[") && segment.endsWith("]")) return "[^/]+";
    return escapeRegExp(segment);
  }).join("/");
  return new RegExp(`^/${source}${exact ? "$" : "(?:/.*)?$"}`);
}

function normalizeRoutePath(pathname: string) {
  const routePath = pathname.trim().split("?")[0].split("#")[0] || "/";
  const withSlash = routePath.startsWith("/") ? routePath : `/${routePath}`;
  return withSlash.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function kindRank(kind: "layout" | "page" | "route") {
  if (kind === "layout") return 0;
  if (kind === "page") return 1;
  return 2;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toPosix(value: string) {
  return value.split(path.sep).join("/");
}

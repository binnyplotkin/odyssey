#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const scanRoots = ["apps", "packages"];
const extensions = new Set([".css", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);

const ignoredPathParts = new Set([
  ".git",
  ".next",
  ".next-preview",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

const allowedPrefixes = [
  "packages/ui/src/styles/",
];

const allowedFiles = new Set();

const deprecatedAliases = [
  "--app-background",
  "--node-canvas",
  "--divider",
  "--panel",
  "--panel-strong",
  "--panel-strong-text",
  "--card",
  "--card-hover",
  "--card-border",
  "--input-bg",
  "--input-border",
  "--dropdown-bg",
  "--dropdown-border",
  "--surface-material",
  "--card-material",
  "--canvas-background",
  "--app-atmosphere",
  "--muted",
  "--dim",
  "--passive-teal",
  "--active-teal",
  "--neural_color",
  "--success",
  "--danger",
  "--forest-950",
  "--forest-900",
  "--forest-800",
  "--forest-700",
  "--forest-600",
  "--forest-500",
  "--forest-400",
  "--forest-300",
  "--forest-200",
  "--forest-100",
  "--forest-50",
];

const canonicalReplacement = new Map([
  ["--app-background", "--background"],
  ["--node-canvas", "--canvas-surface"],
  ["--divider", "--border-subtle"],
  ["--panel", "--surface-1"],
  ["--panel-strong", "--surface-active"],
  ["--panel-strong-text", "--text-primary"],
  ["--card", "--material-card"],
  ["--card-hover", "--surface-hover"],
  ["--card-border", "--border-subtle"],
  ["--input-bg", "--control-bg"],
  ["--input-border", "--control-border"],
  ["--dropdown-bg", "--popover-bg"],
  ["--dropdown-border", "--popover-border"],
  ["--surface-material", "--material-surface"],
  ["--card-material", "--material-card"],
  ["--canvas-background", "--canvas-atmosphere"],
  ["--app-atmosphere", "--page-atmosphere"],
  ["--muted", "--text-tertiary"],
  ["--dim", "--text-quaternary"],
  ["--passive-teal", "--accent"],
  ["--active-teal", "--accent-strong"],
  ["--neural_color", "--accent"],
  ["--success", "--status-live"],
  ["--danger", "--status-error"],
  ["--forest-950", "--background"],
  ["--forest-900", "--sidebar"],
  ["--forest-800", "--surface-1"],
  ["--forest-700", "--surface-2"],
  ["--forest-600", "--surface-active"],
  ["--forest-500", "--accent"],
  ["--forest-400", "--accent-strong"],
  ["--forest-300", "--accent-strong"],
  ["--forest-200", "--emissive-mint"],
  ["--forest-100", "--emissive-mint"],
  ["--forest-50", "--emissive-mint"],
]);

const aliasPattern = new RegExp(
  "(?:" +
    deprecatedAliases
      .sort((a, b) => b.length - a.length)
      .map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|") +
    ")(?![-_a-zA-Z0-9])",
  "g",
);

function toRelative(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function isAllowed(relativePath) {
  return (
    allowedFiles.has(relativePath) ||
    allowedPrefixes.some((prefix) => relativePath.startsWith(prefix))
  );
}

function collectFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (ignoredPathParts.has(entry)) continue;

    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...collectFiles(fullPath));
      continue;
    }

    if (stats.isFile() && extensions.has(path.extname(entry))) {
      files.push(fullPath);
    }
  }
  return files;
}

function lineAndColumn(source, index) {
  const before = source.slice(0, index);
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

const violations = [];

for (const scanRoot of scanRoots) {
  const absoluteRoot = path.join(root, scanRoot);
  for (const filePath of collectFiles(absoluteRoot)) {
    const relativePath = toRelative(filePath);
    if (isAllowed(relativePath)) continue;

    const source = readFileSync(filePath, "utf8");
    for (const match of source.matchAll(aliasPattern)) {
      const alias = match[0];
      const location = lineAndColumn(source, match.index ?? 0);
      violations.push({
        relativePath,
        line: location.line,
        column: location.column,
        alias,
        replacement: canonicalReplacement.get(alias) ?? "a canonical theme token",
      });
    }
  }
}

if (violations.length > 0) {
  console.error(
    `[theme-token-aliases] Found ${violations.length} deprecated theme token alias usage(s).\n` +
      "Use canonical tokens in app/package code. Compatibility aliases are only allowed in packages/ui/src/styles and the admin debug overlay.\n",
  );

  for (const violation of violations.slice(0, 80)) {
    console.error(
      `${violation.relativePath}:${violation.line}:${violation.column} ` +
        `${violation.alias} -> ${violation.replacement}`,
    );
  }

  if (violations.length > 80) {
    console.error(`...and ${violations.length - 80} more.`);
  }

  process.exit(1);
}

console.log("[theme-token-aliases] No deprecated theme token aliases found.");

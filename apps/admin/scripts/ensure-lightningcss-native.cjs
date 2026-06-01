#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

if (process.platform !== "linux") {
  process.exit(0);
}

function detectLibcFamily() {
  try {
    const detect = require("detect-libc");
    const family =
      typeof detect.familySync === "function" ? detect.familySync() : null;
    if (family === detect.MUSL || family === "musl") return "musl";
  } catch {
    // Fall through to glibc default.
  }
  return "gnu";
}

function pickNativePackage() {
  const libc = detectLibcFamily();
  switch (process.arch) {
    case "x64":
      return `lightningcss-linux-x64-${libc}`;
    case "arm64":
      return `lightningcss-linux-arm64-${libc}`;
    case "arm":
      return "lightningcss-linux-arm-gnueabihf";
    default:
      return null;
  }
}

function main() {
  const nativePkg = pickNativePackage();
  if (!nativePkg) {
    console.warn(
      `[build] unsupported Linux arch '${process.arch}' for LightningCSS native preinstall; continuing without patch`,
    );
    return;
  }

  let lightningcssVersion = "latest";
  try {
    lightningcssVersion = require("lightningcss/package.json").version;
  } catch {
    console.warn(
      "[build] lightningcss package not found before build; skipping native preinstall",
    );
    return;
  }

  try {
    require.resolve(nativePkg);
    console.log(`[build] ${nativePkg} already installed`);
    return;
  } catch {
    // Missing native module; install below.
  }

  const spec = `${nativePkg}@${lightningcssVersion}`;
  console.log(`[build] installing missing ${spec} for LightningCSS`);

  const result = spawnSync("npm", ["install", "--no-save", spec], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

main();

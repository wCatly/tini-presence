/**
 * Build script for tini-presence sidecar binary
 * Compiles the TypeScript app to a standalone executable using Bun
 */

import { $ } from "bun";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const TAURI_DIR = join(import.meta.dir, "../src-tauri");
const BINARIES_DIR = join(TAURI_DIR, "binaries");

// Get target triple for current platform
function getTargetTriple(): string {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  return `${arch}-apple-darwin`;
}

async function build() {
  console.log("Building tini-presence sidecar...");

  // Ensure binaries directory exists
  if (!existsSync(BINARIES_DIR)) {
    mkdirSync(BINARIES_DIR, { recursive: true });
  }

  const targetTriple = getTargetTriple();
  const outputName = `tini-presence-core-${targetTriple}`;
  const outputPath = join(BINARIES_DIR, outputName);
  const devOutputPath = join(BINARIES_DIR, "tini-presence-core");

  // Build using Bun's compile feature
  await $`bun build ${join(ROOT, "index.ts")} --compile --outfile ${outputPath}`.cwd(ROOT);

  // Also create a dev-friendly binary without suffix
  try {
    if (existsSync(devOutputPath)) {
      await $`rm ${devOutputPath}`.cwd(BINARIES_DIR);
    }
  } catch {
    // Ignore cleanup errors
  }
  await $`cp ${outputPath} ${devOutputPath}`.cwd(BINARIES_DIR);

  console.log(`Built: ${outputPath}`);
  console.log(`Linked: ${devOutputPath}`);
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});

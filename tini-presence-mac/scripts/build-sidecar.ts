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
function getTargetTriple(archOverride?: string): string {
  const arch =
    archOverride || (process.arch === "arm64" ? "aarch64" : "x86_64");
  return `${arch}-apple-darwin`;
}

async function build() {
  console.log("Building tini-presence sidecar...");

  // Ensure binaries directory exists
  if (!existsSync(BINARIES_DIR)) {
    mkdirSync(BINARIES_DIR, { recursive: true });
  }

  const architectures = ["aarch64", "x86_64"];
  const entryPoint = join(ROOT, "index.ts");

  for (const arch of architectures) {
    const targetTriple = getTargetTriple(arch);
    const outputName = `tini-presence-core-${targetTriple}`;
    const outputPath = join(BINARIES_DIR, outputName);

    console.log(`  - Compiling for ${arch}...`);
    // Build using Bun's compile feature
    await $`bun build ${entryPoint} --compile --target bun-darwin-${arch} --outfile ${outputPath}`.cwd(
      ROOT
    );
  }

  // Create universal binary using lipo (required for Tauri's universal target)
  const aarch64Binary = join(
    BINARIES_DIR,
    "tini-presence-core-aarch64-apple-darwin"
  );
  const x86_64Binary = join(
    BINARIES_DIR,
    "tini-presence-core-x86_64-apple-darwin"
  );
  const universalBinary = join(
    BINARIES_DIR,
    "tini-presence-core-universal-apple-darwin"
  );

  console.log("  - Creating universal FAT binary...");
  await $`lipo -create -output ${universalBinary} ${aarch64Binary} ${x86_64Binary}`;

  // Create dev-friendly binary for current arch session
  const currentTriple = getTargetTriple();
  const currentBinary = join(
    BINARIES_DIR,
    `tini-presence-core-${currentTriple}`
  );
  const devOutputPath = join(BINARIES_DIR, "tini-presence-core");

  try {
    if (existsSync(devOutputPath)) {
      await $`rm ${devOutputPath}`.cwd(BINARIES_DIR);
    }
    await $`cp ${currentBinary} ${devOutputPath}`.cwd(BINARIES_DIR);
  } catch {
    // Ignore cleanup errors
  }

  console.log(
    `Done! Binaries built for both architectures and universal in ${BINARIES_DIR}`
  );
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});

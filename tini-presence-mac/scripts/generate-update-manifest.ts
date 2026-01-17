#!/usr/bin/env bun
/**
 * Post-build script to generate update manifest (latest.json)
 * Run this after `tauri build` to create the update JSON for your CDN
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { createInterface } from "readline";

const BUNDLE_DIR = join(
  import.meta.dir,
  "../src-tauri/target/release/bundle/macos"
);
const OUTPUT_DIR = join(import.meta.dir, "../src-tauri/target/release/bundle");
const TAURI_CONF = join(import.meta.dir, "../src-tauri/tauri.conf.json");

async function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function confirm(question: string): Promise<boolean> {
  const answer = await prompt(`${question} (y/n): `);
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}

function getVersion(): string {
  const config = JSON.parse(readFileSync(TAURI_CONF, "utf-8"));
  return config.version;
}

function findBundleFiles(): { bundle: string; signature: string } | null {
  if (!existsSync(BUNDLE_DIR)) {
    console.error(`❌ Bundle directory not found: ${BUNDLE_DIR}`);
    console.error("   Make sure you've run 'tauri build' first.");
    return null;
  }

  const files = readdirSync(BUNDLE_DIR);
  const tarGz = files.find(
    (f) => f.endsWith(".app.tar.gz") && !f.endsWith(".sig")
  );
  const sig = files.find((f) => f.endsWith(".app.tar.gz.sig"));

  if (!tarGz || !sig) {
    console.error("❌ Could not find bundle files (.app.tar.gz and .sig)");
    console.error("   Available files:", files);
    return null;
  }

  return {
    bundle: tarGz,
    signature: sig,
  };
}

function detectArch(): string {
  const arch = process.arch;
  if (arch === "arm64") return "aarch64";
  if (arch === "x64") return "x86_64";
  return arch;
}

async function main() {
  console.log("\n🔄 Tauri Update Manifest Generator\n");

  // Check for bundle files
  const files = findBundleFiles();
  if (!files) {
    process.exit(1);
  }

  console.log(`📦 Found bundle: ${files.bundle}`);
  console.log(`🔑 Found signature: ${files.signature}`);

  // Ask user if they want to generate
  const shouldGenerate = await confirm(
    "\n🤔 Generate update manifest (latest.json)?"
  );
  if (!shouldGenerate) {
    console.log("👋 Cancelled.");
    process.exit(0);
  }

  // Get version
  const version = getVersion();
  console.log(`\n📌 Version: ${version}`);

  // Get CDN base URL
  const cdnUrl = await prompt(
    "\n🌐 Enter your CDN base URL (e.g., https://cdn.example.com/releases): "
  );
  if (!cdnUrl) {
    console.error("❌ CDN URL is required");
    process.exit(1);
  }

  // Read signature content
  const sigPath = join(BUNDLE_DIR, files.signature);
  const signature = readFileSync(sigPath, "utf-8").trim();

  // Get release notes
  const notes = await prompt(
    "\n📝 Release notes (optional, press Enter to skip): "
  );

  // Detect current architecture
  const arch = detectArch();
  const platform = `darwin-${arch}`;

  // Build download URL
  const downloadUrl = `${cdnUrl.replace(/\/$/, "")}/${files.bundle}`;

  // Generate manifest
  const manifest = {
    version,
    notes: notes || `Release ${version}`,
    pub_date: new Date().toISOString(),
    platforms: {
      [platform]: {
        signature,
        url: downloadUrl,
      },
    },
  };

  // Ask about adding other architectures
  const otherArch = arch === "aarch64" ? "x86_64" : "aarch64";
  const addOther = await confirm(
    `\n🖥️  Add ${otherArch} platform? (if you have another build)`
  );

  if (addOther) {
    const otherBundleName = await prompt(
      `   Bundle filename for darwin-${otherArch}: `
    );
    const otherSigContent = await prompt(
      `   Signature content (or path to .sig file): `
    );

    let otherSig = otherSigContent;
    if (existsSync(otherSigContent)) {
      otherSig = readFileSync(otherSigContent, "utf-8").trim();
    }

    if (otherBundleName && otherSig) {
      manifest.platforms[`darwin-${otherArch}`] = {
        signature: otherSig,
        url: `${cdnUrl.replace(/\/$/, "")}/${otherBundleName}`,
      };
    }
  }

  // Write manifest
  const outputPath = join(OUTPUT_DIR, "latest.json");
  writeFileSync(outputPath, JSON.stringify(manifest, null, 2));

  console.log(`\n✅ Generated: ${outputPath}`);
  console.log("\n📋 Manifest content:");
  console.log("─".repeat(50));
  console.log(JSON.stringify(manifest, null, 2));
  console.log("─".repeat(50));

  console.log("\n📤 Upload these files to your CDN:");
  console.log(`   1. ${join(BUNDLE_DIR, files.bundle)}`);
  console.log(`   2. ${outputPath}`);

  console.log("\n🎉 Done!\n");
}

main().catch(console.error);

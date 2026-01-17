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
const DMG_DIR = join(import.meta.dir, "../src-tauri/target/release/bundle/dmg");
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

function getTauriConfig(): { version: string; endpoint?: string } {
  const config = JSON.parse(readFileSync(TAURI_CONF, "utf-8"));
  return {
    version: config.version,
    endpoint: config.plugins?.updater?.endpoints?.[0],
  };
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

function findDmgFile(): string | null {
  if (!existsSync(DMG_DIR)) return null;
  const files = readdirSync(DMG_DIR);
  return files.find((f) => f.endsWith(".dmg")) || null;
}

async function main() {
  console.clear();
  console.log("\n🔄 Tauri Update Manifest Generator\n");

  const { version, endpoint } = getTauriConfig();
  console.log(`📌 Target Version: ${version}`);

  // Fetch current manifest if endpoint exists
  if (endpoint) {
    try {
      console.log(`📡 Fetching current manifest from ${endpoint}...`);
      const response = await fetch(endpoint);
      if (response.ok) {
        const current = (await response.json()) as Record<string, any>;
        console.log(`✅ Current CDN Version: ${current.version}`);
        if (current.version === version) {
          console.log(
            "⚠️  Warning: Version matches CDN. Increment version in tauri.conf.json if this is a new release."
          );
        }
      } else {
        console.log(
          "ℹ️  No existing manifest found on CDN (or endpoint unreachable)."
        );
      }
    } catch (_err) {
      console.log("⚠️  Could not fetch current manifest for comparison.");
    }
  }

  // Check for bundle files
  const files = findBundleFiles();
  if (!files) {
    process.exit(1);
  }

  console.log(`📦 Found bundle: ${files.bundle}`);
  console.log(`🔑 Found signature: ${files.signature}`);

  // Default CDN URL from tauri.conf.json
  const defaultCdnUrl = endpoint
    ? endpoint.substring(0, endpoint.lastIndexOf("/"))
    : "";

  // Ask user if they want to generate
  const shouldGenerate = await confirm(
    "\n🤔 Generate update manifest (latest.json)?"
  );
  if (!shouldGenerate) {
    console.log("👋 Cancelled.");
    process.exit(0);
  }

  // Get CDN base URL
  const cdnUrlInput = await prompt(
    `\n🌐 Enter your CDN base URL (default: ${defaultCdnUrl || "None"}): `
  );
  const cdnUrl = cdnUrlInput || defaultCdnUrl;

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

  // Build download URL
  const downloadUrl = `${cdnUrl.replace(/\/$/, "")}/${files.bundle}`;

  // Generate manifest
  const manifest: any = {
    version,
    notes: notes || `Release ${version}`,
    pub_date: new Date().toISOString(),
    platforms: {
      "darwin-aarch64": {
        signature,
        url: downloadUrl,
      },
      "darwin-x86_64": {
        signature,
        url: downloadUrl,
      },
    },
  };

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

  const dmg = findDmgFile();
  if (dmg) {
    console.log(`\n💾 Installer (DMG):`);
    console.log(`   ${join(DMG_DIR, dmg)}`);
  }

  console.log("\n🎉 Done!\n");
}

main().catch(console.error);

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";

const CONFIG_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || "~",
  ".config",
  "tini-presence"
);
const IDENTITY_PATH = path.join(CONFIG_DIR, "identity.json");

export interface DeviceIdentity {
  id: string;        // Short unique ID (8 chars)
  name: string;      // Human-readable name (machine hostname)
  createdAt: string; // ISO timestamp
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    Bun.spawnSync(["mkdir", "-p", CONFIG_DIR]);
  }
}

function generateId(): string {
  const entropy = `${hostname()}-${Date.now()}-${Math.random()}-${process.pid}`;
  return createHash("sha256").update(entropy).digest("hex").slice(0, 8);
}

function sanitizeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 32);
}

// Load or create device identity
function loadOrCreateIdentity(): DeviceIdentity {
  ensureConfigDir();

  if (existsSync(IDENTITY_PATH)) {
    try {
      const data = JSON.parse(readFileSync(IDENTITY_PATH, "utf-8"));
      if (data.id && data.name) {
        return data as DeviceIdentity;
      }
    } catch {
      // Corrupted file, regenerate
    }
  }

  const identity: DeviceIdentity = {
    id: generateId(),
    name: sanitizeName(hostname()),
    createdAt: new Date().toISOString(),
  };

  writeFileSync(IDENTITY_PATH, JSON.stringify(identity, null, 2));
  return identity;
}

// Cached identity (loaded once)
let cachedIdentity: DeviceIdentity | null = null;

// For testing: allow overriding identity
let testIdentity: DeviceIdentity | null = null;

export function getIdentity(): DeviceIdentity {
  if (testIdentity) {
    return testIdentity;
  }

  if (!cachedIdentity) {
    cachedIdentity = loadOrCreateIdentity();
  }

  return cachedIdentity;
}

// Get the folder path for uploads: {machine-name}-{id}
// e.g., "macbook-pro-05f5e84b"
export function getDeviceFolder(): string {
  const identity = getIdentity();
  return `${identity.name}-${identity.id}`;
}

// For testing: set a mock identity
export function setTestIdentity(identity: DeviceIdentity | null): void {
  testIdentity = identity;
}

// For testing: reset to real identity
export function resetIdentity(): void {
  testIdentity = null;
  cachedIdentity = null;
}

// Export constants for testing
export const TEST_IDENTITY: DeviceIdentity = {
  id: "test1234",
  name: "test-machine",
  createdAt: "2024-01-01T00:00:00.000Z",
};

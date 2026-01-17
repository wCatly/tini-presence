import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface UploadConfig {
  baseUrl: string;
  uploadPath?: string;
  apiKey: string;
  username?: string;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // ms
  maxDelay: number; // ms
}

export interface UploadResult {
  url: string;
  filename: string;
}

export interface CoverUploadOptions {
  songTitle: string;
  folderName: string;  // e.g., "Music" from /Users/florian/Music/song.mp3
  hash: string;
  extension: string;   // e.g., "jpg"
}

export class UploadError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "UploadError";
  }
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
};

// Sanitize for URL path (remove special chars, keep readable)
function sanitizeForPath(name: string): string {
  return name
    .replace(/[<>:"/\\|?*#%]/g, "") // Remove URL-unsafe chars
    .replace(/\s+/g, "_")            // Replace spaces with underscores
    .trim()
    .slice(0, 100);                  // Limit length
}

// Get or create a persistent device ID
const CONFIG_DIR = path.join(homedir(), ".config", "tini-presence");
const DEVICE_ID_PATH = path.join(CONFIG_DIR, "device-id");

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    Bun.spawnSync(["mkdir", "-p", CONFIG_DIR]);
  }
}

export function getDeviceId(): string {
  ensureConfigDir();
  
  if (existsSync(DEVICE_ID_PATH)) {
    return readFileSync(DEVICE_ID_PATH, "utf-8").trim();
  }
  
  // Generate a short unique ID based on hostname + random
  const base = `${hostname()}-${Date.now()}-${Math.random()}`;
  const deviceId = createHash("sha256").update(base).digest("hex").slice(0, 8);
  
  writeFileSync(DEVICE_ID_PATH, deviceId);
  return deviceId;
}

// Build the full upload path for cover art
// Result: tini-presence/{device-id}/{folder}/{song-title}-{hash}.{ext}
export function buildCoverPath(options: CoverUploadOptions): string {
  const deviceId = getDeviceId();
  const folder = sanitizeForPath(options.folderName);
  const title = sanitizeForPath(options.songTitle);
  const filename = `${title}-${options.hash}.${options.extension}`;
  
  return `tini-presence/${deviceId}/${folder}/${filename}`;
}

// In-memory cache
const uploadCache = new Map<string, string>();

function isRetryableError(error: unknown): boolean {
  if (error instanceof UploadError) {
    return error.retryable;
  }
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return true;
  }
  return false;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelay(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay;
  return Math.min(exponentialDelay + jitter, config.maxDelay);
}

// Create folder on Copyparty (will be auto-created on upload, but explicit is cleaner)
export async function createFolder(
  folderPath: string,
  config: UploadConfig
): Promise<boolean> {
  const uploadPath = config.uploadPath || "/cdn";
  const url = `${config.baseUrl}${uploadPath}/${folderPath}?mkdir`;
  
  const auth = Buffer.from(
    `${config.username || "cdn-api"}:${config.apiKey}`
  ).toString("base64");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function uploadFile(
  data: Uint8Array,
  filePath: string,  // Full path including subfolders, e.g., "tini-presence/abc123/Music/Song-hash.jpg"
  mimeType: string,
  config: UploadConfig,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<UploadResult> {
  const uploadPath = config.uploadPath || "/cdn";
  const uploadUrl = `${config.baseUrl}${uploadPath}/${filePath}?want=url`;

  const auth = Buffer.from(
    `${config.username || "cdn-api"}:${config.apiKey}`
  ).toString("base64");

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": mimeType,
        },
        body: new Blob([data.buffer as ArrayBuffer], { type: mimeType }),
      });

      if (res.ok) {
        const url = (await res.text()).trim();
        return { url, filename: filePath };
      }

      const retryable = isRetryableStatus(res.status);
      const error = new UploadError(
        `Upload failed: ${res.status} ${res.statusText}`,
        res.status,
        retryable
      );

      if (!retryable || attempt === retryConfig.maxRetries) {
        throw error;
      }

      lastError = error;
    } catch (error) {
      if (error instanceof UploadError && !error.retryable) {
        throw error;
      }

      if (!isRetryableError(error) && attempt === retryConfig.maxRetries) {
        throw error;
      }

      lastError = error as Error;
    }

    if (attempt < retryConfig.maxRetries) {
      const delay = getRetryDelay(attempt, retryConfig);
      await sleep(delay);
    }
  }

  throw lastError || new UploadError("Upload failed after retries", undefined, false);
}

export async function uploadWithCache(
  data: Uint8Array,
  filePath: string,
  mimeType: string,
  config: UploadConfig,
  cacheKey?: string,
  retryConfig?: RetryConfig
): Promise<UploadResult> {
  const key = cacheKey || filePath;
  const cached = uploadCache.get(key);

  if (cached) {
    return { url: cached, filename: filePath };
  }

  const result = await uploadFile(data, filePath, mimeType, config, retryConfig);
  uploadCache.set(key, result.url);

  return result;
}

export function clearCache(): void {
  uploadCache.clear();
}

export function getCacheSize(): number {
  return uploadCache.size;
}

export class UploadService {
  private config: UploadConfig;
  private retryConfig: RetryConfig;

  constructor(config: UploadConfig, retryConfig?: Partial<RetryConfig>) {
    this.config = config;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  get deviceId(): string {
    return getDeviceId();
  }

  async upload(
    data: Uint8Array,
    filePath: string,
    mimeType: string
  ): Promise<UploadResult> {
    return uploadFile(data, filePath, mimeType, this.config, this.retryConfig);
  }

  async uploadCached(
    data: Uint8Array,
    filePath: string,
    mimeType: string,
    cacheKey?: string
  ): Promise<UploadResult> {
    return uploadWithCache(data, filePath, mimeType, this.config, cacheKey, this.retryConfig);
  }

  // Upload cover art with organized path structure
  async uploadCover(
    data: Uint8Array,
    mimeType: string,
    options: CoverUploadOptions
  ): Promise<UploadResult> {
    const filePath = buildCoverPath(options);
    return this.uploadCached(data, filePath, mimeType, options.hash);
  }

  async createFolder(folderPath: string): Promise<boolean> {
    return createFolder(folderPath, this.config);
  }

  clearCache(): void {
    clearCache();
  }

  get cacheSize(): number {
    return getCacheSize();
  }
}

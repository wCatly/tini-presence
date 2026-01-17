import { getDeviceFolder } from "./identity.ts";

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

// Build the full upload path for cover art
// Result: tini-presence/{machine-name}-{id}/{folder}/{song-title}-{hash}.{ext}
export function buildCoverPath(options: CoverUploadOptions): string {
  const deviceFolder = getDeviceFolder();
  const folder = sanitizeForPath(options.folderName);
  const title = sanitizeForPath(options.songTitle);
  const filename = `${title}-${options.hash}.${options.extension}`;
  
  return `tini-presence/${deviceFolder}/${folder}/${filename}`;
}

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

/**
 * Upload file to CDN using PUT
 * 
 * With Copyparty's u2ow setting, uploading the same filename will:
 * - Overwrite if content is different
 * - Return existing URL if content is the same (deduplication)
 * 
 * This means we don't need to check if file exists first - just upload!
 */
export async function uploadFile(
  data: Uint8Array,
  filePath: string,
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

export class UploadService {
  private config: UploadConfig;
  private retryConfig: RetryConfig;

  constructor(config: UploadConfig, retryConfig?: Partial<RetryConfig>) {
    this.config = config;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  async upload(
    data: Uint8Array,
    filePath: string,
    mimeType: string
  ): Promise<UploadResult> {
    return uploadFile(data, filePath, mimeType, this.config, this.retryConfig);
  }

  /**
   * Upload cover art with organized path structure
   * 
   * Copyparty handles deduplication - same file = same URL returned
   * No need to check if file exists first!
   */
  async uploadCover(
    data: Uint8Array,
    mimeType: string,
    options: CoverUploadOptions
  ): Promise<UploadResult> {
    const filePath = buildCoverPath(options);
    return this.upload(data, filePath, mimeType);
  }
}

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

const uploadCache = new Map<string, string>();

function isRetryableError(error: unknown): boolean {
  if (error instanceof UploadError) {
    return error.retryable;
  }
  // Network errors are retryable
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return true;
  }
  return false;
}

function isRetryableStatus(status: number): boolean {
  // 429 = rate limited, 5xx = server errors
  return status === 429 || (status >= 500 && status < 600);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelay(attempt: number, config: RetryConfig): number {
  // Exponential backoff with jitter
  const exponentialDelay = config.baseDelay * Math.pow(2, attempt);
  const jitter = Math.random() * 0.3 * exponentialDelay; // 0-30% jitter
  return Math.min(exponentialDelay + jitter, config.maxDelay);
}

export async function uploadFile(
  data: Uint8Array,
  filename: string,
  mimeType: string,
  config: UploadConfig,
  retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<UploadResult> {
  const uploadPath = config.uploadPath || "/cdn";
  const uploadUrl = `${config.baseUrl}${uploadPath}/?want=url`;

  const formData = new FormData();
  formData.append(
    "f",
    new Blob([data.buffer as ArrayBuffer], { type: mimeType }),
    filename
  );

  const auth = Buffer.from(
    `${config.username || "cdn-api"}:${config.apiKey}`
  ).toString("base64");

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
        },
        body: formData,
      });

      if (res.ok) {
        const url = (await res.text()).trim();
        return { url, filename };
      }

      // Check if we should retry based on status code
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
      // Don't retry if it's a non-retryable error
      if (error instanceof UploadError && !error.retryable) {
        throw error;
      }

      // Check if it's a network error (retryable)
      if (!isRetryableError(error) && attempt === retryConfig.maxRetries) {
        throw error;
      }

      lastError = error as Error;
    }

    // Wait before retrying
    if (attempt < retryConfig.maxRetries) {
      const delay = getRetryDelay(attempt, retryConfig);
      await sleep(delay);
    }
  }

  // Should not reach here, but just in case
  throw lastError || new UploadError("Upload failed after retries", undefined, false);
}

export async function uploadWithCache(
  data: Uint8Array,
  filename: string,
  mimeType: string,
  config: UploadConfig,
  cacheKey?: string,
  retryConfig?: RetryConfig
): Promise<UploadResult> {
  const key = cacheKey || filename;
  const cached = uploadCache.get(key);

  if (cached) {
    return { url: cached, filename };
  }

  const result = await uploadFile(data, filename, mimeType, config, retryConfig);
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

  async upload(
    data: Uint8Array,
    filename: string,
    mimeType: string
  ): Promise<UploadResult> {
    return uploadFile(data, filename, mimeType, this.config, this.retryConfig);
  }

  async uploadCached(
    data: Uint8Array,
    filename: string,
    mimeType: string,
    cacheKey?: string
  ): Promise<UploadResult> {
    return uploadWithCache(data, filename, mimeType, this.config, cacheKey, this.retryConfig);
  }

  clearCache(): void {
    clearCache();
  }

  get cacheSize(): number {
    return getCacheSize();
  }
}

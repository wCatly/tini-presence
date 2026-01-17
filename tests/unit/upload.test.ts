import { describe, expect, test, beforeEach, beforeAll, afterAll } from "bun:test";
import {
  uploadFile,
  uploadWithCache,
  clearCache,
  getCacheSize,
  UploadService,
  UploadError,
  buildCoverPath,
} from "../../src/upload.ts";
import { setTestIdentity, resetIdentity, TEST_IDENTITY, getDeviceFolder } from "../../src/identity.ts";
import type { UploadConfig, RetryConfig } from "../../src/upload.ts";

const testConfig: UploadConfig = {
  baseUrl: "https://example.com",
  uploadPath: "/cdn",
  apiKey: "test-api-key",
};

const fastRetryConfig: RetryConfig = {
  maxRetries: 2,
  baseDelay: 10, // Fast for testing
  maxDelay: 100,
};

// Helper to mock fetch
function mockFetch(impl: () => Promise<Response>): () => void {
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = impl;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("Upload Service", () => {
  // Use test identity for all upload tests
  beforeAll(() => {
    setTestIdentity(TEST_IDENTITY);
  });

  afterAll(() => {
    resetIdentity();
  });

  beforeEach(() => {
    clearCache();
  });

  describe("UploadError", () => {
    test("creates error with status code and retryable flag", () => {
      const error = new UploadError("Test error", 500, true);
      expect(error.message).toBe("Test error");
      expect(error.statusCode).toBe(500);
      expect(error.retryable).toBe(true);
      expect(error.name).toBe("UploadError");
    });

    test("defaults retryable to false", () => {
      const error = new UploadError("Test error", 400);
      expect(error.retryable).toBe(false);
    });
  });

  describe("uploadFile", () => {
    test("throws UploadError on 400 Bad Request (non-retryable)", async () => {
      const restore = mockFetch(() =>
        Promise.resolve(new Response("Bad Request", { status: 400, statusText: "Bad Request" }))
      );

      try {
        await expect(
          uploadFile(new Uint8Array([1, 2, 3]), "test.jpg", "image/jpeg", testConfig, fastRetryConfig)
        ).rejects.toThrow(UploadError);

        try {
          await uploadFile(new Uint8Array([1, 2, 3]), "test.jpg", "image/jpeg", testConfig, fastRetryConfig);
        } catch (e) {
          expect(e).toBeInstanceOf(UploadError);
          expect((e as UploadError).statusCode).toBe(400);
          expect((e as UploadError).retryable).toBe(false);
        }
      } finally {
        restore();
      }
    });

    test("retries on 500 Server Error", async () => {
      let attempts = 0;

      const restore = mockFetch(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.resolve(new Response("Server Error", { status: 500, statusText: "Internal Server Error" }));
        }
        return Promise.resolve(new Response("https://example.com/cdn/test.jpg"));
      });

      try {
        const result = await uploadFile(
          new Uint8Array([1, 2, 3]),
          "test.jpg",
          "image/jpeg",
          testConfig,
          fastRetryConfig
        );
        expect(result.url).toBe("https://example.com/cdn/test.jpg");
        expect(attempts).toBe(3);
      } finally {
        restore();
      }
    });

    test("retries on 429 Rate Limit", async () => {
      let attempts = 0;

      const restore = mockFetch(() => {
        attempts++;
        if (attempts === 1) {
          return Promise.resolve(new Response("Rate Limited", { status: 429, statusText: "Too Many Requests" }));
        }
        return Promise.resolve(new Response("https://example.com/cdn/test.jpg"));
      });

      try {
        const result = await uploadFile(
          new Uint8Array([1, 2, 3]),
          "test.jpg",
          "image/jpeg",
          testConfig,
          fastRetryConfig
        );
        expect(result.url).toBe("https://example.com/cdn/test.jpg");
        expect(attempts).toBe(2);
      } finally {
        restore();
      }
    });

    test("gives up after max retries", async () => {
      let attempts = 0;

      const restore = mockFetch(() => {
        attempts++;
        return Promise.resolve(new Response("Server Error", { status: 500, statusText: "Internal Server Error" }));
      });

      try {
        await expect(
          uploadFile(new Uint8Array([1, 2, 3]), "test.jpg", "image/jpeg", testConfig, fastRetryConfig)
        ).rejects.toThrow(UploadError);
        expect(attempts).toBe(3); // Initial + 2 retries
      } finally {
        restore();
      }
    });

    test("successful upload returns URL", async () => {
      const restore = mockFetch(() =>
        Promise.resolve(new Response("https://example.com/cdn/uploaded.jpg"))
      );

      try {
        const result = await uploadFile(
          new Uint8Array([1, 2, 3]),
          "test.jpg",
          "image/jpeg",
          testConfig,
          fastRetryConfig
        );
        expect(result.url).toBe("https://example.com/cdn/uploaded.jpg");
        expect(result.filename).toBe("test.jpg");
      } finally {
        restore();
      }
    });
  });

  describe("uploadWithCache", () => {
    test("caches successful uploads", async () => {
      let fetchCalls = 0;

      const restore = mockFetch(() => {
        fetchCalls++;
        return Promise.resolve(new Response("https://example.com/cdn/cached.jpg"));
      });

      try {
        const data = new Uint8Array([1, 2, 3]);
        const result1 = await uploadWithCache(data, "test.jpg", "image/jpeg", testConfig, "cache-key", fastRetryConfig);
        const result2 = await uploadWithCache(data, "test.jpg", "image/jpeg", testConfig, "cache-key", fastRetryConfig);

        expect(result1.url).toBe(result2.url);
        expect(fetchCalls).toBe(1); // Only one fetch, second was cached
        expect(getCacheSize()).toBe(1);
      } finally {
        restore();
      }
    });

    test("uses filename as cache key if not provided", async () => {
      const restore = mockFetch(() =>
        Promise.resolve(new Response("https://example.com/cdn/file.jpg"))
      );

      try {
        await uploadWithCache(new Uint8Array([1]), "unique-file.jpg", "image/jpeg", testConfig, undefined, fastRetryConfig);
        await uploadWithCache(new Uint8Array([1]), "unique-file.jpg", "image/jpeg", testConfig, undefined, fastRetryConfig);

        expect(getCacheSize()).toBe(1);
      } finally {
        restore();
      }
    });
  });

  describe("cache functions", () => {
    test("clearCache empties the cache", async () => {
      const restore = mockFetch(() =>
        Promise.resolve(new Response("https://example.com/cdn/test.jpg"))
      );

      try {
        await uploadWithCache(new Uint8Array([1]), "a.jpg", "image/jpeg", testConfig, "a", fastRetryConfig);
        await uploadWithCache(new Uint8Array([2]), "b.jpg", "image/jpeg", testConfig, "b", fastRetryConfig);

        expect(getCacheSize()).toBe(2);
        clearCache();
        expect(getCacheSize()).toBe(0);
      } finally {
        restore();
      }
    });
  });

  describe("UploadService class", () => {
    test("uses custom retry config", async () => {
      let attempts = 0;

      const restore = mockFetch(() => {
        attempts++;
        return Promise.resolve(new Response("Server Error", { status: 500, statusText: "Internal Server Error" }));
      });

      const service = new UploadService(testConfig, { maxRetries: 1, baseDelay: 5, maxDelay: 10 });

      try {
        await expect(
          service.upload(new Uint8Array([1, 2, 3]), "test.jpg", "image/jpeg")
        ).rejects.toThrow(UploadError);
        expect(attempts).toBe(2); // Initial + 1 retry
      } finally {
        restore();
      }
    });

    test("uploadCached uses cache", async () => {
      let fetchCalls = 0;

      const restore = mockFetch(() => {
        fetchCalls++;
        return Promise.resolve(new Response("https://example.com/cdn/service.jpg"));
      });

      const service = new UploadService(testConfig, fastRetryConfig);

      try {
        clearCache();
        const data = new Uint8Array([1, 2, 3]);
        await service.uploadCached(data, "test.jpg", "image/jpeg", "service-key");
        await service.uploadCached(data, "test.jpg", "image/jpeg", "service-key");

        expect(fetchCalls).toBe(1);
        expect(service.cacheSize).toBe(1);

        service.clearCache();
        expect(service.cacheSize).toBe(0);
      } finally {
        restore();
      }
    });

    test("uploadCover builds correct path", async () => {
      const restore = mockFetch(() =>
        Promise.resolve(new Response("https://example.com/cdn/uploaded.jpg"))
      );

      const service = new UploadService(testConfig, fastRetryConfig);

      try {
        clearCache();
        const result = await service.uploadCover(
          new Uint8Array([1, 2, 3]),
          "image/jpeg",
          {
            songTitle: "My Song",
            folderName: "Music",
            hash: "abc123",
            extension: "jpg",
          }
        );

        // Should contain device folder, folder, song title, and hash
        expect(result.filename).toContain("tini-presence");
        expect(result.filename).toContain("test-machine-test1234"); // Test identity
        expect(result.filename).toContain("Music");
        expect(result.filename).toContain("My_Song");
        expect(result.filename).toContain("abc123");
      } finally {
        restore();
      }
    });
  });

  describe("buildCoverPath", () => {
    test("builds correct path structure with test identity", () => {
      const path = buildCoverPath({
        songTitle: "Test Song",
        folderName: "My Music",
        hash: "abcd1234",
        extension: "jpg",
      });

      // Uses test identity: test-machine-test1234
      expect(path).toBe("tini-presence/test-machine-test1234/My_Music/Test_Song-abcd1234.jpg");
    });

    test("sanitizes special characters", () => {
      const path = buildCoverPath({
        songTitle: "Song: With <Special> Chars?",
        folderName: "Music/Folder",
        hash: "xyz789",
        extension: "png",
      });

      expect(path).not.toContain(":");
      expect(path).not.toContain("<");
      expect(path).not.toContain(">");
      expect(path).not.toContain("?");
      expect(path).toContain("xyz789.png");
    });
  });
});

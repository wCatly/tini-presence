import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import {
  uploadFile,
  uploadIfNotExists,
  fileExists,
  UploadService,
  UploadError,
  buildCoverPath,
} from "../../src/upload.ts";
import { setTestIdentity, resetIdentity, TEST_IDENTITY } from "../../src/identity.ts";
import type { UploadConfig, RetryConfig } from "../../src/upload.ts";

const testConfig: UploadConfig = {
  baseUrl: "https://example.com",
  uploadPath: "/cdn",
  apiKey: "test-api-key",
};

const fastRetryConfig: RetryConfig = {
  maxRetries: 2,
  baseDelay: 10,
  maxDelay: 100,
};

// Helper to mock fetch
function mockFetch(impl: (url?: string, options?: any) => Promise<Response>): () => void {
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = impl;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("Upload Service", () => {
  beforeAll(() => {
    setTestIdentity(TEST_IDENTITY);
  });

  afterAll(() => {
    resetIdentity();
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
        expect(result.existed).toBe(false);
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

    test("successful upload returns URL with existed=false", async () => {
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
        expect(result.existed).toBe(false);
      } finally {
        restore();
      }
    });
  });

  describe("fileExists", () => {
    test("returns URL if file exists (200)", async () => {
      const restore = mockFetch(() =>
        Promise.resolve(new Response(null, { status: 200 }))
      );

      try {
        const url = await fileExists("test.jpg", testConfig);
        expect(url).toBe("https://example.com/cdn/test.jpg");
      } finally {
        restore();
      }
    });

    test("returns null if file doesn't exist (404)", async () => {
      const restore = mockFetch(() =>
        Promise.resolve(new Response(null, { status: 404 }))
      );

      try {
        const url = await fileExists("test.jpg", testConfig);
        expect(url).toBeNull();
      } finally {
        restore();
      }
    });

    test("returns null on network error", async () => {
      const restore = mockFetch(() =>
        Promise.reject(new Error("Network error"))
      );

      try {
        const url = await fileExists("test.jpg", testConfig);
        expect(url).toBeNull();
      } finally {
        restore();
      }
    });
  });

  describe("uploadIfNotExists", () => {
    test("returns existing URL without uploading (existed=true)", async () => {
      let uploadCalled = false;

      const restore = mockFetch((_url?: string, options?: any) => {
        if (options?.method === "HEAD") {
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        uploadCalled = true;
        return Promise.resolve(new Response("https://example.com/cdn/new.jpg"));
      });

      try {
        const result = await uploadIfNotExists(
          new Uint8Array([1, 2, 3]),
          "existing.jpg",
          "image/jpeg",
          testConfig,
          fastRetryConfig
        );
        expect(result.url).toBe("https://example.com/cdn/existing.jpg");
        expect(result.existed).toBe(true);
        expect(uploadCalled).toBe(false);
      } finally {
        restore();
      }
    });

    test("uploads if file doesn't exist (existed=false)", async () => {
      let uploadCalled = false;

      const restore = mockFetch((_url?: string, options?: any) => {
        if (options?.method === "HEAD") {
          return Promise.resolve(new Response(null, { status: 404 }));
        }
        uploadCalled = true;
        return Promise.resolve(new Response("https://example.com/cdn/new.jpg"));
      });

      try {
        const result = await uploadIfNotExists(
          new Uint8Array([1, 2, 3]),
          "new.jpg",
          "image/jpeg",
          testConfig,
          fastRetryConfig
        );
        expect(result.url).toBe("https://example.com/cdn/new.jpg");
        expect(result.existed).toBe(false);
        expect(uploadCalled).toBe(true);
      } finally {
        restore();
      }
    });
  });

  describe("UploadService class", () => {
    test("uses custom retry config", async () => {
      let attempts = 0;

      const restore = mockFetch((_url?: string, options?: any) => {
        if (options?.method === "HEAD") {
          return Promise.resolve(new Response(null, { status: 404 }));
        }
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

    test("uploadCover checks existence first", async () => {
      let headCalled = false;
      let putCalled = false;

      const restore = mockFetch((_url?: string, options?: any) => {
        if (options?.method === "HEAD") {
          headCalled = true;
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        putCalled = true;
        return Promise.resolve(new Response("https://example.com/cdn/uploaded.jpg"));
      });

      const service = new UploadService(testConfig, fastRetryConfig);

      try {
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

        expect(headCalled).toBe(true);
        expect(putCalled).toBe(false); // File existed, no upload
        expect(result.existed).toBe(true);
        expect(result.filename).toBe("tini-presence/test-machine-test1234/Music/My_Song-abc123.jpg");
      } finally {
        restore();
      }
    });

    test("coverExists returns URL if exists", async () => {
      const restore = mockFetch(() =>
        Promise.resolve(new Response(null, { status: 200 }))
      );

      const service = new UploadService(testConfig);

      try {
        const url = await service.coverExists({
          songTitle: "Test Song",
          folderName: "Music",
          hash: "xyz789",
          extension: "jpg",
        });

        expect(url).toContain("tini-presence");
        expect(url).toContain("Test_Song");
      } finally {
        restore();
      }
    });

    test("exists method checks file existence", async () => {
      const restore = mockFetch(() =>
        Promise.resolve(new Response(null, { status: 200 }))
      );

      const service = new UploadService(testConfig);

      try {
        const url = await service.exists("some/path/file.jpg");
        expect(url).toBe("https://example.com/cdn/some/path/file.jpg");
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

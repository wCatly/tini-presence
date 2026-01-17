import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { extractCoverArt } from "../../src/cover.ts";

const TEST_MUSIC_DIR = resolve(import.meta.dir, "../../test-music");

describe("Cover Art", () => {
  describe("extractCoverArt", () => {
    test("extracts cover from MP3 with embedded art", async () => {
      const filePath = `${TEST_MUSIC_DIR}/Test Song One.mp3`;
      const cover = await extractCoverArt(filePath);

      expect(cover).not.toBeNull();
      expect(cover?.mimeType).toBe("image/jpeg");
      expect(cover?.data.length).toBeGreaterThan(0);
    });

    test("extracts cover from Another Track.mp3", async () => {
      const filePath = `${TEST_MUSIC_DIR}/Another Track.mp3`;
      const cover = await extractCoverArt(filePath);

      expect(cover).not.toBeNull();
      expect(cover?.mimeType).toBe("image/jpeg");
    });

    test("extracts cover from Third Song.mp3", async () => {
      const filePath = `${TEST_MUSIC_DIR}/Third Song.mp3`;
      const cover = await extractCoverArt(filePath);

      expect(cover).not.toBeNull();
      expect(cover?.mimeType).toBe("image/jpeg");
    });

    test("returns null for non-existent file", async () => {
      const cover = await extractCoverArt("/non/existent/file.mp3");
      expect(cover).toBeNull();
    });

    test("returns null for file without cover", async () => {
      // Create a temp file without cover for this test
      const tempPath = "/tmp/no-cover-test.txt";
      await Bun.write(tempPath, "not an mp3");

      const cover = await extractCoverArt(tempPath);
      expect(cover).toBeNull();
    });
  });

  describe("hashBuffer", () => {
    test("produces consistent hash for same data", async () => {
      const { createHash } = await import("node:crypto");
      const hashBuffer = (buffer: Uint8Array): string =>
        createHash("sha256").update(buffer).digest("hex").slice(0, 16);

      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const hash1 = hashBuffer(data);
      const hash2 = hashBuffer(data);

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(16);
    });

    test("produces different hash for different data", async () => {
      const { createHash } = await import("node:crypto");
      const hashBuffer = (buffer: Uint8Array): string =>
        createHash("sha256").update(buffer).digest("hex").slice(0, 16);

      const data1 = new Uint8Array([1, 2, 3]);
      const data2 = new Uint8Array([4, 5, 6]);

      expect(hashBuffer(data1)).not.toBe(hashBuffer(data2));
    });
  });

  describe("Cover extraction from all test files", () => {
    test("all test MP3s have valid covers", async () => {
      const files = ["Test Song One.mp3", "Another Track.mp3", "Third Song.mp3"];

      for (const file of files) {
        const cover = await extractCoverArt(`${TEST_MUSIC_DIR}/${file}`);
        expect(cover).not.toBeNull();
        expect(cover?.data).toBeInstanceOf(Uint8Array);
        expect(cover?.mimeType).toMatch(/^image\//);
      }
    });
  });
});

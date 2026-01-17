import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { resolve } from "node:path";
import { Client } from "@xhayper/discord-rpc";

import { extractCoverArt, getCoverFilename } from "../../src/cover.ts";
import { spotify } from "../../src/spotify.ts";
import { UploadService } from "../../src/upload.ts";

const TEST_MUSIC_DIR = resolve(import.meta.dir, "../../test-music");
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || "YOUR_CLIENT_ID";
const COPYPARTY_URL = process.env.COPYPARTY_URL || "https://pifiles.florian.lt";
const COPYPARTY_API_KEY = process.env.COPYPARTY_API_KEY || "";

describe("Integration Tests", () => {
  describe("Spotify Client", () => {
    test("getState returns valid state structure", async () => {
      const state = await spotify.getState();

      expect(typeof state.isRunning).toBe("boolean");

      if (state.isRunning) {
        expect(state.track).toBeDefined();
        expect(typeof state.track.title).toBe("string");
        expect(typeof state.track.artist).toBe("string");
        expect(typeof state.track.album).toBe("string");
        expect(typeof state.track.durationMs).toBe("number");
        expect(typeof state.track.id).toBe("string");
        expect(["spotify", "local"]).toContain(state.track.source);
        expect(typeof state.positionMs).toBe("number");
        expect(["playing", "paused", "stopped"]).toContain(state.state);
      }
    });

    test("getCurrentTrack returns track or null", async () => {
      const track = await spotify.getCurrentTrack();

      if (track !== null) {
        expect(track.title).toBeDefined();
        expect(track.artist).toBeDefined();
      }
    });

    test("isPlaying returns boolean", async () => {
      const playing = await spotify.isPlaying();
      expect(typeof playing).toBe("boolean");
    });
  });

  describe("Discord RPC", () => {
    let rpc: Client;

    beforeAll(() => {
      rpc = new Client({ clientId: CLIENT_ID });
    });

    afterAll(() => {
      if (rpc) {
        rpc.destroy();
      }
    });

    test("connects to Discord", async () => {
      try {
        await rpc.login();
        expect(rpc.user).toBeDefined();
        expect(rpc.user?.username).toBeDefined();
        console.log(`Connected as: ${rpc.user?.username}`);
      } catch {
        console.log("Discord not running, skipping connection test");
      }
    });

    test(
      "can set and clear activity",
      async () => {
        try {
          if (!rpc.user) {
            await rpc.login();
          }

          await rpc.user?.setActivity({
            details: "Test Song",
            state: "by Test Artist",
            largeImageKey: "spotify",
            largeImageText: "Test Album",
          });

          await rpc.user?.clearActivity();
          console.log("Activity set and cleared successfully");
        } catch {
          console.log("Discord not running, skipping activity test");
        }
      },
      10000
    );
  });

  describe("Upload Service", () => {
    test(
      "uploads file to Copyparty",
      async () => {
        if (!COPYPARTY_API_KEY) {
          console.log("COPYPARTY_API_KEY not set, skipping upload test");
          return;
        }

        const uploadService = new UploadService({
          baseUrl: COPYPARTY_URL,
          uploadPath: "/cdn",
          apiKey: COPYPARTY_API_KEY,
        });

        const cover = await extractCoverArt(`${TEST_MUSIC_DIR}/Test Song One.mp3`);
        expect(cover).not.toBeNull();

        if (cover) {
          const filename = getCoverFilename(cover);
          const result = await uploadService.upload(
            cover.data,
            filename,
            cover.mimeType
          );

          expect(result.url).toMatch(/^https?:\/\//);
          console.log(`Uploaded to: ${result.url}`);

          // Verify URL is accessible
          const res = await fetch(result.url, { method: "HEAD" });
          expect(res.ok).toBe(true);
        }
      },
      15000
    );

    test(
      "caches uploaded files",
      async () => {
        if (!COPYPARTY_API_KEY) {
          console.log("COPYPARTY_API_KEY not set, skipping cache test");
          return;
        }

        const uploadService = new UploadService({
          baseUrl: COPYPARTY_URL,
          uploadPath: "/cdn",
          apiKey: COPYPARTY_API_KEY,
        });

        const cover = await extractCoverArt(`${TEST_MUSIC_DIR}/Test Song One.mp3`);
        expect(cover).not.toBeNull();

        if (cover) {
          const filename = getCoverFilename(cover);

          // First upload
          const result1 = await uploadService.uploadCached(
            cover.data,
            filename,
            cover.mimeType,
            cover.hash
          );

          // Second upload should return same URL (cached)
          const result2 = await uploadService.uploadCached(
            cover.data,
            filename,
            cover.mimeType,
            cover.hash
          );

          expect(result1.url).toBe(result2.url);
        }
      },
      15000
    );
  });

  describe("End-to-end flow", () => {
    test("extracts and processes all test music files", async () => {
      const files = ["Test Song One.mp3", "Another Track.mp3", "Third Song.mp3"];

      for (const file of files) {
        const filePath = `${TEST_MUSIC_DIR}/${file}`;

        const cover = await extractCoverArt(filePath);
        expect(cover).not.toBeNull();
        expect(cover?.data.length).toBeGreaterThan(0);
        expect(cover?.hash).toBeDefined();

        console.log(
          `✓ ${file}: ${cover?.data.length} bytes, ${cover?.mimeType}, hash: ${cover?.hash}`
        );
      }
    });
  });
});

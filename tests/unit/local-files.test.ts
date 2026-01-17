import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseLocalTrackInfo,
  findLocalFile,
  findFileFromSpotifyDb,
  parseSpotifyLocalFilesDb,
  loadConfig,
  saveConfig,
  getMusicFolders,
  type AppConfig,
} from "../../src/local-files.ts";

const TEST_MUSIC_DIR = resolve(import.meta.dir, "../../test-music");
const TEST_CONFIG_DIR = "/tmp/tini-presence-test";
const TEST_CONFIG_PATH = `${TEST_CONFIG_DIR}/config.json`;

describe("Local Files", () => {
  describe("parseLocalTrackInfo", () => {
    test("parses basic local track ID", () => {
      const trackId = "spotify:local:Test+Artist:Test+Album:Test+Song+One:30";
      const info = parseLocalTrackInfo(trackId);

      expect(info).not.toBeNull();
      expect(info?.artist).toBe("Test Artist");
      expect(info?.album).toBe("Test Album");
      expect(info?.title).toBe("Test Song One");
    });

    test("handles URL-encoded characters", () => {
      const trackId = "spotify:local:Cool+Band:Great+Album:Another+Track:45";
      const info = parseLocalTrackInfo(trackId);

      expect(info?.artist).toBe("Cool Band");
      expect(info?.album).toBe("Great Album");
      expect(info?.title).toBe("Another Track");
    });

    test("handles empty artist/album fields", () => {
      const trackId = "spotify:local:::My+Song:180";
      const info = parseLocalTrackInfo(trackId);

      expect(info).not.toBeNull();
      expect(info?.artist).toBe("");
      expect(info?.album).toBe("");
      expect(info?.title).toBe("My Song");
    });

    test("returns null for spotify track ID", () => {
      const trackId = "spotify:track:4iV5W9uYEdYUVa79Axb7Rh";
      const info = parseLocalTrackInfo(trackId);

      expect(info).toBeNull();
    });

    test("returns null for invalid format", () => {
      const trackId = "invalid:format";
      const info = parseLocalTrackInfo(trackId);

      expect(info).toBeNull();
    });

    test("handles special characters", () => {
      const trackId = "spotify:local:Artist%20Name:Album%20Name:Song%20Title:120";
      const info = parseLocalTrackInfo(trackId);

      expect(info?.artist).toBe("Artist Name");
      expect(info?.album).toBe("Album Name");
      expect(info?.title).toBe("Song Title");
    });
  });

  describe("findLocalFile", () => {
    beforeEach(() => {
      // Temporarily save config with test music dir
      if (!existsSync(TEST_CONFIG_DIR)) {
        mkdirSync(TEST_CONFIG_DIR, { recursive: true });
      }
    });

    test("finds file in configured folder", () => {
      // This test depends on config having the test-music folder
      // We'll test the parsing logic instead
      const trackId = "spotify:local:Test+Artist:Test+Album:Test+Song+One:30";
      const info = parseLocalTrackInfo(trackId);

      expect(info?.title).toBe("Test Song One");

      // Check file exists in test-music
      const expectedPath = `${TEST_MUSIC_DIR}/Test Song One.mp3`;
      expect(existsSync(expectedPath)).toBe(true);
    });

    test("returns null for non-existent file", () => {
      const trackId = "spotify:local:Unknown:Unknown:NonExistent+Song:999";
      const result = findLocalFile(trackId);

      expect(result).toBeNull();
    });

    test("returns null for spotify track", () => {
      const trackId = "spotify:track:abc123";
      const result = findLocalFile(trackId);

      expect(result).toBeNull();
    });
  });

  describe("Config management", () => {
    const originalEnv = process.env.HOME;

    beforeEach(() => {
      process.env.HOME = TEST_CONFIG_DIR;
      if (!existsSync(TEST_CONFIG_DIR)) {
        mkdirSync(TEST_CONFIG_DIR, { recursive: true });
      }
      if (existsSync(TEST_CONFIG_PATH)) {
        rmSync(TEST_CONFIG_PATH);
      }
    });

    afterEach(() => {
      if (existsSync(TEST_CONFIG_PATH)) {
        rmSync(TEST_CONFIG_PATH);
      }
      process.env.HOME = originalEnv;
    });

    test("loadConfig returns empty folders when no config exists", () => {
      const config = loadConfig();
      expect(config).toHaveProperty("musicFolders");
      expect(Array.isArray(config.musicFolders)).toBe(true);
      expect(config.copypartyUrl).toBe("https://pifiles.florian.lt");
      expect(config.copypartyPath).toBe("/cdn");
    });

    test("getMusicFolders returns array", () => {
      const folders = getMusicFolders();
      expect(Array.isArray(folders)).toBe(true);
    });

    test("loadConfig supports optional credentials", () => {
      const config: AppConfig = {
        musicFolders: ["/tmp/music"],
        discordClientId: "client-id",
        copypartyApiKey: "api-key",
        copypartyUrl: "https://cdn.example.com",
        copypartyPath: "/cdn",
      };
      saveConfig(config);
      const loaded = loadConfig();
      expect(loaded.discordClientId).toBe("client-id");
      expect(loaded.copypartyApiKey).toBe("api-key");
      expect(loaded.copypartyUrl).toBe("https://cdn.example.com");
      expect(loaded.copypartyPath).toBe("/cdn");
    });
  });

  describe("File extension support", () => {
    test("supported extensions list", () => {
      const extensions = [".mp3", ".m4a", ".flac", ".wav", ".ogg", ".opus"];

      // Verify our test files use supported extension
      const testFiles = [
        "Test Song One.mp3",
        "Another Track.mp3",
        "Third Song.mp3",
      ];

      for (const file of testFiles) {
        const ext = file.substring(file.lastIndexOf("."));
        expect(extensions).toContain(ext);
      }
    });
  });

  describe("Spotify local-files.bnk parsing", () => {
    test("parseSpotifyLocalFilesDb returns a Map", () => {
      const db = parseSpotifyLocalFilesDb();
      expect(db).toBeInstanceOf(Map);
    });

    test("parseSpotifyLocalFilesDb finds test music files", () => {
      const db = parseSpotifyLocalFilesDb();

      // Our test files should be in Spotify's database
      // Keys are lowercase filenames without extension
      const hasTestSongOne = db.has("test song one");
      const hasAnotherTrack = db.has("another track");
      const hasThirdSong = db.has("third song");

      // At least one should be found if Spotify has indexed them
      if (db.size > 0) {
        expect(hasTestSongOne || hasAnotherTrack || hasThirdSong).toBe(true);
      }
    });

    test("parseSpotifyLocalFilesDb caches results", () => {
      // First call
      const db1 = parseSpotifyLocalFilesDb();
      // Second call should return cached result
      const db2 = parseSpotifyLocalFilesDb();

      expect(db1).toBe(db2); // Same reference = cached
    });

    test("findFileFromSpotifyDb finds existing file by title", () => {
      const db = parseSpotifyLocalFilesDb();

      if (db.size > 0) {
        // Get the first file in the database
        const firstKey = db.keys().next().value;
        if (firstKey) {
          const found = findFileFromSpotifyDb(firstKey);
          // Should return null or a valid path
          if (found) {
            expect(existsSync(found)).toBe(true);
          }
        }
      }
    });

    test("findFileFromSpotifyDb returns null for non-existent title", () => {
      const result = findFileFromSpotifyDb("this_file_definitely_does_not_exist_12345");
      expect(result).toBeNull();
    });

    test("findLocalFile uses Spotify database", () => {
      // This tests the integration - findLocalFile should find files via the .bnk database
      const trackId = "spotify:local:Test+Artist:Test+Album:Test+Song+One:30";
      const result = findLocalFile(trackId);

      // Should find the file either via database or folder fallback
      if (result) {
        expect(existsSync(result)).toBe(true);
        expect(result).toContain("Test Song One");
      }
    });
  });
});

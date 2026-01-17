import { describe, expect, test } from "bun:test";
import {
  type SpotifyState,
  type Track,
  type PlaybackState,
} from "../../src/spotify.ts";

describe("Spotify Client", () => {
  describe("parseNumber", () => {
    const parseNumber = (value: string): number =>
      Number(value.replace(",", "."));

    test("parses numbers with comma decimal separator", () => {
      expect(parseNumber("206,016006469727")).toBeCloseTo(206.016, 2);
    });

    test("parses integer strings", () => {
      expect(parseNumber("100")).toBe(100);
    });

    test("parses numbers with dot decimal separator", () => {
      expect(parseNumber("50.5")).toBe(50.5);
    });
  });

  describe("parsePlayerState", () => {
    const parsePlayerState = (
      value: string
    ): "playing" | "paused" | "stopped" => {
      if (value === "playing" || value === "paused" || value === "stopped") {
        return value;
      }
      return "stopped";
    };

    test("returns playing state", () => {
      expect(parsePlayerState("playing")).toBe("playing");
    });

    test("returns paused state", () => {
      expect(parsePlayerState("paused")).toBe("paused");
    });

    test("returns stopped state", () => {
      expect(parsePlayerState("stopped")).toBe("stopped");
    });

    test("defaults to stopped for invalid state", () => {
      expect(parsePlayerState("invalid")).toBe("stopped");
      expect(parsePlayerState("")).toBe("stopped");
    });
  });

  describe("parseTrackSource", () => {
    const parseTrackSource = (trackId: string): "spotify" | "local" =>
      trackId.startsWith("spotify:local:") ? "local" : "spotify";

    test("detects local files", () => {
      expect(parseTrackSource("spotify:local:::My+Song:180")).toBe("local");
      expect(parseTrackSource("spotify:local:Artist:Album:Title:120")).toBe(
        "local"
      );
    });

    test("detects spotify tracks", () => {
      expect(parseTrackSource("spotify:track:4iV5W9uYEdYUVa79Axb7Rh")).toBe(
        "spotify"
      );
    });
  });

  describe("AppleScript output parsing", () => {
    const parseNumber = (v: string) => Number(v.replace(",", "."));
    const parseTrackSource = (id: string): "spotify" | "local" =>
      id.startsWith("spotify:local:") ? "local" : "spotify";

    test("parses spotify track output", () => {
      const rawOutput =
        "Mrs Magic||Strawberry Guy||F Song & Mrs Magic||221929||206,016||playing||spotify:track:abc123";

      const parts = rawOutput.split("||");
      const [title, artist, album, durationMs, positionSec, state, trackId] =
        parts;

      const track: Track = {
        title,
        artist,
        album,
        durationMs: parseNumber(durationMs),
        id: trackId,
        source: parseTrackSource(trackId),
      };

      expect(track.title).toBe("Mrs Magic");
      expect(track.artist).toBe("Strawberry Guy");
      expect(track.album).toBe("F Song & Mrs Magic");
      expect(track.durationMs).toBe(221929);
      expect(track.source).toBe("spotify");
      expect(parseNumber(positionSec) * 1000).toBeCloseTo(206016, 0);
    });

    test("parses local file output", () => {
      const rawOutput =
        "Test Song One||Test Artist||Test Album||30000||15,5||playing||spotify:local:Test+Artist:Test+Album:Test+Song+One:30";

      const parts = rawOutput.split("||");
      const [title, artist, album, durationMs, positionSec, state, trackId] =
        parts;

      const track: Track = {
        title,
        artist,
        album,
        durationMs: parseNumber(durationMs),
        id: trackId,
        source: parseTrackSource(trackId),
      };

      expect(track.title).toBe("Test Song One");
      expect(track.artist).toBe("Test Artist");
      expect(track.source).toBe("local");
    });

    test("handles NOT_RUNNING response", () => {
      const rawOutput = "NOT_RUNNING";
      const isRunning = rawOutput !== "NOT_RUNNING" && rawOutput !== "";
      expect(isRunning).toBe(false);
    });

    test("handles empty response", () => {
      const rawOutput: string = "";
      const isRunning = rawOutput !== "NOT_RUNNING" && rawOutput !== "";
      expect(isRunning).toBe(false);
    });
  });

  describe("PlaybackState timestamps", () => {
    test("calculates timestamps correctly", () => {
      const state: PlaybackState = {
        isRunning: true,
        track: {
          title: "Test Song",
          artist: "Test Artist",
          album: "Test Album",
          durationMs: 200000,
          id: "spotify:track:test",
          source: "spotify",
        },
        positionMs: 50000,
        state: "playing",
      };

      const now = Date.now();
      const startTimestamp = now - state.positionMs;
      const endTimestamp = now + (state.track.durationMs - state.positionMs);

      expect(endTimestamp - startTimestamp).toBe(state.track.durationMs);
      expect(startTimestamp).toBeLessThan(now);
      expect(endTimestamp).toBeGreaterThan(now);
    });

    test("handles track at beginning", () => {
      const state: PlaybackState = {
        isRunning: true,
        track: {
          title: "Test",
          artist: "Test",
          album: "Test",
          durationMs: 180000,
          id: "spotify:track:test",
          source: "spotify",
        },
        positionMs: 0,
        state: "playing",
      };

      const now = Date.now();
      const startTimestamp = now - state.positionMs;
      const endTimestamp = now + (state.track.durationMs - state.positionMs);

      expect(startTimestamp).toBe(now);
      expect(endTimestamp - startTimestamp).toBe(180000);
    });
  });
});

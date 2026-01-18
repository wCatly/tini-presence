import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeString,
  findLocalFile,
  saveConfig,
  loadConfig,
  localFiles,
  type AppConfig,
} from "../../src/local-files.ts";

const TEST_DIR = "/tmp/tini-presence-advanced-test";
const TEST_MUSIC_DIR = join(TEST_DIR, "Music");
const TEST_CONFIG_PATH = join(TEST_DIR, ".config/tini-presence/config.json");

describe("Advanced Matching Logic", () => {
  // Setup environment
  const originalEnv = process.env.HOME;

  beforeEach(() => {
    process.env.HOME = TEST_DIR;
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_MUSIC_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, ".config/tini-presence"), { recursive: true });

    // Save config pointing to test music dir
    const config: AppConfig = {
      musicFolders: [TEST_MUSIC_DIR],
      copypartyUrl: "",
      copypartyPath: "",
    };
    saveConfig(config);

    // Clear caches to avoid stale DB results
    localFiles.clearCaches();
  });

  afterEach(() => {
    // Cleanup
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    process.env.HOME = originalEnv;
  });

  describe("normalizeString", () => {
    test("handles accents", () => {
      expect(normalizeString("MÉNAGE")).toBe("menage");
      expect(normalizeString("Garçons")).toBe("garcons");
      expect(normalizeString("Crème Brûlée")).toBe("creme brulee");
      expect(normalizeString("Plić")).toBe("plic"); // Specific user request
      expect(normalizeString("Łódź")).toBe("lodz"); // Polish chars
      expect(normalizeString("Dvořák")).toBe("dvorak"); // Czech chars

      // German
      expect(normalizeString("Äpfel")).toBe("apfel");
      expect(normalizeString("Öl")).toBe("ol");
      expect(normalizeString("Übung")).toBe("ubung");
      expect(normalizeString("Straßenbahn")).toBe("strassenbahn"); // Eszett usually normalizes to 'ss' or 's', NFD keeps it as ß? No, NFD doesn't decompose ß. We need to check this.

      // Scandinavian
      expect(normalizeString("Åland")).toBe("aland");
      expect(normalizeString("Ægir")).toBe("aegir"); // or 'aegir'? NFD might leave Æ.
      expect(normalizeString("Øresund")).toBe("oresund"); // NFD might leave Ø.

      // Spanish / Portuguese
      expect(normalizeString("Mañana")).toBe("manana");
      expect(normalizeString("João")).toBe("joao");

      // French
      expect(normalizeString("Çava")).toBe("cava");
      expect(normalizeString("Noël")).toBe("noel");
      expect(normalizeString("Être")).toBe("etre");

      // Polish (more)
      expect(normalizeString("Śnieg")).toBe("snieg");
      expect(normalizeString("Żółw")).toBe("zolw");
      expect(normalizeString("Źrebię")).toBe("zrebie");
      expect(normalizeString("Ąę")).toBe("ae");
    });

    test("handles special characters", () => {
      expect(normalizeString("S.O.S.")).toBe("s o s");
      expect(normalizeString("AC/DC")).toBe("ac dc");
      expect(normalizeString("100%")).toBe("100");
    });

    test("strips extra info when requested", () => {
      expect(normalizeString("Song (Remix)", true)).toBe("song");
      expect(normalizeString("Title [Live]", true)).toBe("title");
      expect(normalizeString("Track (feat. Artist)", true)).toBe("track");
    });

    test("strips leading numbers when requested", () => {
      expect(normalizeString("01. Song", false, true)).toBe("song");
      expect(normalizeString("12 - Title", false, true)).toBe("title");
      expect(normalizeString("5 Track", false, true)).toBe("track");
    });

    test("combines stripping options", () => {
      expect(normalizeString("01. Song (Live)", true, true)).toBe("song");
    });
  });

  describe("Scoring & Disambiguation", () => {
    const createTestFile = (name: string) => {
      const path = join(TEST_MUSIC_DIR, name);
      writeFileSync(path, "dummy content");
      return path;
    };

    test("prioritizes exact match over partial", () => {
      createTestFile("Song.mp3");
      createTestFile("Song (Live).mp3");

      // trackId for "Song"
      // spotify:local:Artist:Album:Title:Duration
      const trackId = "spotify:local:Artist:Album:Song:123";
      const found = findLocalFile(trackId);

      expect(found).not.toBeNull();
      expect(found?.endsWith("/Song.mp3")).toBe(true);
    });

    test("finds file with space mismatch (Space-Blind)", () => {
      createTestFile("WholeLottaRed.mp3");

      const trackId = "spotify:local:Carti:Album:Whole+Lotta+Red:123";
      const found = findLocalFile(trackId);

      expect(found).not.toBeNull();
      // Should match WholeLottaRed.mp3 even though title is "Whole Lotta Red"
      expect(found?.endsWith("WholeLottaRed.mp3")).toBe(true);
    });

    test("prioritizes high quality format (.flac > .mp3)", () => {
      createTestFile("Track.mp3");
      createTestFile("Track.flac");

      const trackId = "spotify:local:Artist:Album:Track:123";
      const found = findLocalFile(trackId);

      expect(found).not.toBeNull();
      expect(found?.endsWith("Track.flac")).toBe(true);
    });

    test("handles leading numbers correctly", () => {
      createTestFile("01. Intro.mp3");

      const trackId = "spotify:local:Artist:Album:Intro:123";
      const found = findLocalFile(trackId);

      expect(found).not.toBeNull();
      expect(found?.endsWith("01. Intro.mp3")).toBe(true);
    });

    test("prioritizes Artist match in filename", () => {
      // Exact title match but "wrong" artist vs fuzzy title but "correct" artist
      // Actually, simplest case: "Title.mp3" vs "Artist - Title.mp3"
      // Our logic scores "Artist - Title" higher if artist matches

      createTestFile("Title.mp3");
      createTestFile("The Artist - Title.mp3");

      const trackId = "spotify:local:The+Artist:Album:Title:123";
      const found = findLocalFile(trackId);

      // "Title.mp3" -> Exact title match (+100)
      // "The Artist - Title.mp3" -> Partial title match (maybe?) OR
      // Wait, if nameNorm === titleNorm, score is 100.
      // "Title" == "Title" -> 100.
      // "The Artist - Title" != "Title".
      // But "The Artist - Title" contains "The Artist" (+60) AND matches title logic?

      // Actually "Title.mp3" is a better match for "Title" than "Artist - Title.mp3".
      // The scoring prioritizes Exact Name Match (100) over Artist Match in Filename (60).
      // However, let's test a case where BOTH are fuzzy, but one has artist.

      // Case: "Run" (Track)
      // Files: "Run (Live).mp3" vs "Pink Floyd - Run.mp3"
      // "Run (Live)" -> title match w/ extra? No, title "Run" is inside "Run (Live)".
      // "Pink Floyd - Run" -> contains artist "Pink Floyd".

      createTestFile("Run (Live).mp3");
      createTestFile("Pink Floyd - Run.mp3");

      const trackId2 = "spotify:local:Pink+Floyd:Album:Run:123";
      const found2 = findLocalFile(trackId2);

      // "Run (Live)" -> nameNoExtra="run" == title="run" -> +90 pts.
      // "Pink Floyd - Run" -> name="pink floyd - run".
      //   - exact? no.
      //   - noExtra? no.
      //   - substring? yes, "run" inside "pink floyd - run" -> +50.
      //   - artist match? "pink floyd" in name -> +60.
      // Total: 110 pts.

      // So "Pink Floyd - Run" (110) should beat "Run (Live)" (90).
      expect(found2?.endsWith("Pink Floyd - Run.mp3")).toBe(true);
    });

    test("matches MÉNAGE to 19. MENAGE.mp3", () => {
      createTestFile("19. MENAGE.mp3");
      const trackId =
        "spotify:local:Artist:Album:M%C3%89NAGE+%28with+Lil+Uzi+Vert%29:123";
      // Title: MÉNAGE (with Lil Uzi Vert)
      // File: 19. MENAGE.mp3

      const found = findLocalFile(trackId);
      expect(found).not.toBeNull();
      expect(found?.endsWith("19. MENAGE.mp3")).toBe(true);
    });
  });
});

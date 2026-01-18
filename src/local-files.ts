import { exec } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  watch,
  statSync,
  type FSWatcher,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import slugify from "slugify";

const execAsync = promisify(exec);

export function getConfigPath(): string {
  const home = process.env.HOME || homedir();
  return path.join(home, ".config", "tini-presence", "config.json");
}
const SPOTIFY_USERS_PATH = path.join(
  homedir(),
  "Library",
  "Application Support",
  "Spotify",
  "Users",
);

export interface AppConfig {
  musicFolders: string[];
  discordClientId?: string;
  copypartyApiKey?: string;
  copypartyUrl?: string;
  copypartyPath?: string;
}

export type LocalFilesConfig = AppConfig;

function ensureConfigDir(): void {
  const dir = path.dirname(getConfigPath());
  if (!existsSync(dir)) {
    Bun.spawnSync(["mkdir", "-p", dir]);
  }
}

const DEFAULT_CONFIG: AppConfig = {
  musicFolders: [],
  discordClientId: "",
  copypartyApiKey: "",
  copypartyUrl: "https://pifiles.florian.lt",
  copypartyPath: "/cdn",
};

export function loadConfig(): AppConfig {
  try {
    const configPath = getConfigPath();
    if (existsSync(configPath)) {
      const data = readFileSync(configPath, "utf-8");
      return { ...DEFAULT_CONFIG, ...(JSON.parse(data) as AppConfig) };
    }
  } catch {
    // Ignore errors
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(config: AppConfig): void {
  ensureConfigDir();
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}

export async function pickFolder(): Promise<string | null> {
  const script = `
    set chosenFolder to choose folder with prompt "Select your music folder"
    return POSIX path of chosenFolder
  `;

  try {
    const { stdout } = await execAsync(`osascript -e '${script}'`);
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function addMusicFolder(): Promise<string | null> {
  const folder = await pickFolder();

  if (folder) {
    const config = loadConfig();
    if (!config.musicFolders.includes(folder)) {
      config.musicFolders.push(folder);
      saveConfig(config);
    }
    return folder;
  }

  return null;
}

export function removeMusicFolder(folder: string): void {
  const config = loadConfig();
  config.musicFolders = config.musicFolders.filter((f) => f !== folder);
  saveConfig(config);
}

export function getMusicFolders(): string[] {
  return loadConfig().musicFolders;
}

export function getConfig(): AppConfig {
  return loadConfig();
}

export function getDefaultConfig(): AppConfig {
  return { ...DEFAULT_CONFIG };
}

export function updateConfig(partial: Partial<AppConfig>): AppConfig {
  const config = loadConfig();
  const next = { ...config, ...partial };
  saveConfig(next);
  return next;
}

/**
 * Normalizes a string for comparison by:
 * 1. Converting to lowercase
 * 2. Mapping special characters (German sharp S, Nordic AE, etc.)
 * 3. Removing accents (NFKD normalization)
 * 3. Optional: Removing text in brackets/parentheses
 * 4. Optional: Removing leading track numbers (e.g., "01. ", "02 - ")
 * 5. Replacing non-alphanumeric characters with spaces
 * 6. Collapsing multiple spaces
 */
export function normalizeString(
  str: string,
  stripExtra = false,
  stripNumbers = false,
): string {
  let s = str;

  if (stripExtra) {
    // Remove (feat...), (original mix), [V1], etc.
    s = s.replace(/\s*[\(\[].*?[\)\]]/g, "");
  }

  if (stripNumbers) {
    // Remove starting numbers like "01. ", "1 - ", "12 "
    // biome-ignore lint/complexity/noUselessEscapeInRegex: Required for correct matching
    s = s.replace(/^\d+[\s\.\-_]*/, "");
  }

  // Replace common separators with spaces to preserve them during slugify
  // Replace % with empty string (100% -> 100) or space? User wanted 100% -> 100
  s = s.replace(/%/g, "");
  s = s.replace(/[\/\.\-_&]/g, " ");

  // Use slugify to handle special characters (transliteration)
  // e.g. "MÉNAGE" -> "menage", "Łódź" -> "lodz"
  // biome-ignore lint/suspicious/noExplicitAny: library type issue
  // @ts-ignore
  s = (slugify as any)(s, {
    replacement: " ", // Replace spaces with space
    lower: true, // Lowercase
    strict: false, // Don't strip special chars yet
    locale: "vi", // Use 'vi' locale for best ASCII approximation usually
    trim: true,
  });

  return s
    .replace(/[^a-z0-9]/g, " ") // Replace symbols with spaces
    .replace(/\s+/g, " ")
    .trim();
}

// Cache for Spotify's local files database
let spotifyLocalFilesCache: Map<string, string> | null = null;

export class LocalFileFinder {
  private watchers: Map<string, FSWatcher> = new Map();
  private listeners: (() => void)[] = [];

  constructor() {
    // Initial sync
    this.refreshWatchers();
  }

  /**
   * Force clear all local file caches
   */
  clearCaches(notify = false): void {
    console.log("[local-files] Clearing all caches...");
    spotifyLocalFilesCache = null;

    if (notify) {
      this.notifyChange();
    }
  }

  notifyChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private refreshWatchers(): void {
    const folders = getMusicFolders();

    // Remove watchers for folders no longer in config
    for (const [folder, watcher] of this.watchers) {
      if (!folders.includes(folder)) {
        watcher.close();
        this.watchers.delete(folder);
      }
    }

    // Add watchers for new folders
    for (const folder of folders) {
      if (!this.watchers.has(folder) && existsSync(folder)) {
        try {
          console.log(`[local-files] Starting watcher for: ${folder}`);
          const watcher = watch(
            folder,
            { recursive: true },
            (event, filename) => {
              console.log(
                `[local-files] FS Event: ${event} on ${filename || "unknown file"} in ${folder}`,
              );

              // Check extension if filename is provided
              if (filename) {
                const ext = path.extname(filename).toLowerCase();
                const audioExts = [
                  ".mp3",
                  ".m4a",
                  ".flac",
                  ".wav",
                  ".ogg",
                  ".opus",
                ];
                if (filename !== ".DS_Store" && !audioExts.includes(ext)) {
                  return;
                }
              }

              // Invalidate caches and notify
              this.clearCaches(true);
            },
          );

          watcher.on("error", (err: Error) => {
            console.error(`[local-files] Watcher error for ${folder}:`, err);
            this.watchers.delete(folder);
          });

          this.watchers.set(folder, watcher);
        } catch (err: unknown) {
          console.error(`[local-files] Failed to watch ${folder}:`, err);
        }
      }
    }
  }

  onChange(callback: () => void): () => void {
    this.listeners.push(callback);
    // Refresh watchers if we have listeners
    this.refreshWatchers();

    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
      if (this.listeners.length === 0) {
        // Stop all watchers if no one is listening
        for (const watcher of this.watchers.values()) {
          watcher.close();
        }
        this.watchers.clear();
      }
    };
  }

  async promptAddFolder(): Promise<string | null> {
    const folder = await addMusicFolder();
    if (folder) {
      this.refreshWatchers();
    }
    return folder;
  }

  getFolders(): string[] {
    return getMusicFolders();
  }

  removeFolder(folder: string): void {
    removeMusicFolder(folder);
    const watcher = this.watchers.get(folder);
    if (watcher) {
      watcher.close();
      this.watchers.delete(folder);
    }
  }

  findFile(trackId: string): string | null {
    return findLocalFile(trackId);
  }
}

// Single instance
export const localFiles = new LocalFileFinder();

/**
 * Standalone helper to clear caches via the instance
 */
export function clearLocalFileCaches(notify = false): void {
  localFiles.clearCaches(notify);
}

let bnkFileWatchersStarted = false;
let lastBnkMtime = 0;

/**
 * Get the mtime of all .bnk files combined (used for cache invalidation)
 */
function getBnkMtime(): number {
  try {
    if (!existsSync(SPOTIFY_USERS_PATH)) return 0;

    const userDirs = readdirSync(SPOTIFY_USERS_PATH, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    let maxMtime = 0;
    for (const userDir of userDirs) {
      const bnkPath = path.join(SPOTIFY_USERS_PATH, userDir, "local-files.bnk");
      if (existsSync(bnkPath)) {
        const stat = statSync(bnkPath);
        maxMtime = Math.max(maxMtime, stat.mtimeMs);
      }
    }
    return maxMtime;
  } catch {
    return 0;
  }
}

/**
 * Start watching .bnk files for changes and invalidate cache when they change
 */
function startBnkWatchers(): void {
  if (bnkFileWatchersStarted) return;
  bnkFileWatchersStarted = true;

  try {
    if (!existsSync(SPOTIFY_USERS_PATH)) return;

    const userDirs = readdirSync(SPOTIFY_USERS_PATH, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const userDir of userDirs) {
      const userPath = path.join(SPOTIFY_USERS_PATH, userDir);

      // Watch the directory for file creation/changes
      try {
        watch(userPath, (event, filename) => {
          if (filename === "local-files.bnk") {
            console.log(
              "[local-files] Spotify database (bnk) changed, invalidating...",
            );
            localFiles.clearCaches(true);
          }
        });
      } catch {
        // Ignore watch errors
      }
    }

    // Also watch the Users directory for new user folders
    try {
      watch(SPOTIFY_USERS_PATH, () => {
        localFiles.clearCaches(true);
      });
    } catch {
      // Ignore watch errors
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Parse Spotify's local-files.bnk database to extract file paths.
 * The .bnk file is a binary format, but file paths are stored as plain strings.
 * We extract paths that look like absolute file paths.
 * Cache is automatically invalidated when the file changes.
 */
export function parseSpotifyLocalFilesDb(): Map<string, string> {
  // Start watchers on first call
  startBnkWatchers();

  // Check if file has changed (fallback for systems where watch doesn't work)
  const currentMtime = getBnkMtime();
  if (currentMtime !== lastBnkMtime) {
    spotifyLocalFilesCache = null;
    lastBnkMtime = currentMtime;
  }

  // Return cached result if valid
  if (spotifyLocalFilesCache) {
    return spotifyLocalFilesCache;
  }

  const fileMap = new Map<string, string>();
  const spotifyUsersPath = path.join(
    process.env.HOME || "",
    "Library/Application Support/Spotify/Users",
  );

  try {
    if (!existsSync(spotifyUsersPath)) {
      return fileMap;
    }

    // Find all user directories
    const userDirs = readdirSync(spotifyUsersPath, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const userDir of userDirs) {
      const bnkPath = path.join(spotifyUsersPath, userDir, "local-files.bnk");
      if (!existsSync(bnkPath)) continue;

      // Read the binary file
      const buffer = readFileSync(bnkPath);
      const content = buffer.toString("utf-8");

      // Extract file paths - they start with / and end with common audio extensions
      // Use RegExp constructor to avoid control character issues in literal
      // biome-ignore lint/complexity/useRegexLiterals: Complex regex with control chars
      const pathRegex = new RegExp(
        "(\\/[^\\x00-\\x1f]+?\\.(mp3|m4a|flac|wav|ogg|opus|aac|wma))",
        "gi",
      );
      const matches = content.matchAll(pathRegex);

      for (const match of matches) {
        const filePath = match[1];
        // Use lowercase filename without extension as key for matching
        const fileName = path
          .basename(filePath, path.extname(filePath))
          .toLowerCase();
        fileMap.set(fileName, filePath);
      }
    }
  } catch {
    // Ignore errors reading Spotify database
  }

  spotifyLocalFilesCache = fileMap;
  return fileMap;
}

interface MatchResult {
  path: string;
  score: number;
}

/**
 * Find a local file path from Spotify's database by matching title and artist.
 * Returns the best match based on a scoring system.
 */
export function findFileFromSpotifyDb(
  title: string,
  artist?: string,
  album?: string,
): string | null {
  const db = parseSpotifyLocalFilesDb();

  const titleNorm = normalizeString(title);
  const titleNoExtra = normalizeString(title, true);
  const titleNoSpace = titleNorm.replace(/\s/g, "");

  const artistNorm = artist ? normalizeString(artist) : "";
  const albumNorm = album ? normalizeString(album) : "";

  const matches: MatchResult[] = [];

  // Helper to check and score a match
  const checkMatch = (key: string, filePath: string) => {
    const keyNorm = normalizeString(key);
    const keyNoExtra = normalizeString(key, true);
    const keyNoNum = normalizeString(key, false, true);
    const keyNoExtraNoNum = normalizeString(key, true, true);
    const keyNoSpace = keyNorm.replace(/\s/g, "");

    let score = 0;
    let matched = false;

    // 1. Exact or bracket-less match (Highest Confidence)
    if (keyNorm === titleNorm) {
      score += 100;
      matched = true;
    } else if (keyNoExtra === titleNoExtra) {
      score += 75; // Reduced from 90 to avoid "Song (Live)" beating "Artist - Song"
      matched = true;
    } else if (keyNoNum === titleNorm) {
      score += 80;
      matched = true;
    } else if (keyNoExtraNoNum === titleNoExtra) {
      score += 70;
      matched = true;
    }
    // 2. Substring match for titles (min 4 chars)
    else if (titleNoExtra.length >= 4) {
      if (keyNoExtra.includes(titleNoExtra)) {
        score += 50;
        matched = true;
      } else if (keyNoNum.includes(titleNoExtra)) {
        score += 45;
        matched = true;
      } else if (keyNoExtraNoNum.includes(titleNoExtra)) {
        score += 40;
        matched = true;
      }
    }
    // 3. Space-blind match
    else if (
      titleNoSpace.length >= 5 &&
      (keyNoSpace === titleNoSpace ||
        keyNoSpace.includes(titleNoSpace) ||
        titleNoSpace.includes(keyNoSpace))
    ) {
      score += 30;
      matched = true;
    }
    // 4. Artist + Title mismatch check
    else if (
      artistNorm &&
      keyNorm.includes(artistNorm) &&
      (keyNorm.includes(titleNorm) || keyNorm.includes(titleNoExtra))
    ) {
      score += 85; // High confidence if artist is explicitly in file name
      matched = true;
    }

    if (matched) {
      // Bonus: Album match in path?
      if (albumNorm && filePath.toLowerCase().includes(albumNorm)) {
        score += 20;
      }

      // Bonus: High quality format?
      if (filePath.endsWith(".flac") || filePath.endsWith(".wav")) {
        score += 5;
      }

      matches.push({ path: filePath, score });
    }
  };

  // Iterative search for better performance/accuracy
  for (const [key, filePath] of db) {
    checkMatch(key, filePath);
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  return matches.length > 0 ? matches[0].path : null;
}

// Parse track info from Spotify local track ID
// Format: spotify:local:Artist:Album:Title:Duration
export function parseLocalTrackInfo(trackId: string): {
  artist: string;
  album: string;
  title: string;
} | null {
  if (!trackId.startsWith("spotify:local:")) {
    return null;
  }

  const parts = trackId.replace("spotify:local:", "").split(":");
  if (parts.length < 3) return null;

  const [artistEncoded, albumEncoded, titleEncoded] = parts;

  return {
    artist: decodeURIComponent(artistEncoded.replace(/\+/g, " ")),
    album: decodeURIComponent(albumEncoded.replace(/\+/g, " ")),
    title: decodeURIComponent(titleEncoded.replace(/\+/g, " ")),
  };
}

/**
 * Find a local music file for a Spotify track.
 * 1. Checks Spotify's local-files.bnk database
 * 2. Falls back to recursive folder search
 */
export function findLocalFile(trackId: string): string | null {
  const info = parseLocalTrackInfo(trackId);
  if (!info) return null;

  const { title, artist, album } = info;

  // Try Spotify DB first
  const dbPath = findFileFromSpotifyDb(title, artist, album);
  if (dbPath) return dbPath;

  // Fallback: search configured folders
  const folders = getMusicFolders();
  const extensions = [".mp3", ".m4a", ".flac", ".wav", ".ogg", ".opus"];
  const matches: MatchResult[] = [];

  // Search recursively in each configured folder
  for (const folder of folders) {
    searchRecursiveAll(folder, title, artist, album, extensions, matches);
  }

  if (matches.length > 0) {
    matches.sort((a, b) => b.score - a.score);
    return matches[0].path;
  }

  return null;
}

function searchRecursiveAll(
  dir: string,
  title: string,
  artist: string,
  album: string,
  extensions: string[],
  matches: MatchResult[],
  depth = 0,
): void {
  if (depth > 5) return;

  try {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });

    const titleNorm = normalizeString(title);
    const titleNoExtra = normalizeString(title, true);
    const titleNoSpace = titleNorm.replace(/\s/g, "");
    const artistNorm = normalizeString(artist);
    const albumNorm = normalizeString(album);

    // Files first
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!extensions.includes(ext)) continue;

        const name = path.basename(entry.name, ext);
        const nameNorm = normalizeString(name);
        const nameNoExtra = normalizeString(name, true);
        const nameNoNum = normalizeString(name, false, true);
        const nameNoExtraNoNum = normalizeString(name, true, true);
        const nameNoSpace = nameNorm.replace(/\s/g, "");

        let score = 0;
        let matched = false;

        // Match Logic & Scoring
        if (nameNorm === titleNorm) {
          score += 100;
          matched = true;
        } else if (nameNoExtra === titleNoExtra) {
          score += 75;
          matched = true;
        } else if (nameNoNum === titleNorm) {
          score += 80;
          matched = true;
        } else if (nameNoExtraNoNum === titleNoExtra) {
          score += 70;
          matched = true;
        } else if (
          titleNoExtra.length >= 4 &&
          (nameNoExtra.includes(titleNoExtra) ||
            nameNoNum.includes(titleNoExtra) ||
            nameNoExtraNoNum.includes(titleNoExtra))
        ) {
          score += 50;
          matched = true;
        } else if (
          titleNoSpace.length >= 5 &&
          (nameNoSpace === titleNoSpace ||
            nameNoSpace.includes(titleNoSpace) ||
            titleNoSpace.includes(nameNoSpace))
        ) {
          score += 30;
          matched = true;
        } else if (
          artistNorm &&
          nameNorm.includes(artistNorm) &&
          (nameNorm.includes(titleNorm) || nameNorm.includes(titleNoExtra))
        ) {
          score += 85;
          matched = true;
        }

        if (matched) {
          // Bonus: Album match in path?
          if (albumNorm && dir.toLowerCase().includes(albumNorm)) {
            score += 20;
          }
          // Bonus: High quality?
          if (ext === ".flac" || ext === ".wav") {
            score += 5;
          }
          matches.push({ path: path.join(dir, entry.name), score });
        }
      }
    }

    // Then directories
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (
          entry.name.startsWith(".") ||
          ["node_modules", "Library", "System", "Applications"].includes(
            entry.name,
          )
        ) {
          continue;
        }

        searchRecursiveAll(
          path.join(dir, entry.name),
          title,
          artist,
          album,
          extensions,
          matches,
          depth + 1,
        );
      }
    }
  } catch {
    // Ignore errors
  }
}

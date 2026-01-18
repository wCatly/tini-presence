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
 * Normalizes a string for comparison by removing all non-alphanumeric characters
 * and converting to lowercase. This creates a "signature" for fuzzy matching.
 * Handles multiple scripts (Latin, Cyrillic, CJK, etc.)
 */
export function normalizeForMatch(str: string): string {
  // Process character by character to handle mixed scripts
  let result = "";

  for (const char of str.toLowerCase()) {
    // Try to transliterate this character using slugify
    // biome-ignore lint/suspicious/noExplicitAny: library type issue
    // @ts-ignore
    const slugified = (slugify as any)(char, {
      replacement: "",
      lower: true,
      strict: true,
      locale: "en",
      trim: true,
    });

    if (slugified.length > 0) {
      // Slugify handled it (e.g., é -> e, Б -> b)
      result += slugified;
    } else if (/[\p{L}\p{N}]/u.test(char)) {
      // Keep letters/numbers that slugify couldn't transliterate (CJK, etc.)
      result += char;
    }
    // Otherwise skip (punctuation, spaces, etc.)
  }

  return result;
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

// Cache for file paths from Spotify's local files database
let spotifyFilePathsCache: string[] | null = null;

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
    spotifyFilePathsCache = null;

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

/**
 * Get all local files with their metadata from the Spotify database.
 * This extracts the actual metadata from the audio files.
 */
export async function getAllLocalFilesWithMetadata(): Promise<
  Array<{
    filePath: string;
    title: string;
    artist: string;
    album: string;
    hasCover: boolean;
  }>
> {
  // Dynamic import to avoid circular dependency
  const { extractMetadata } = await import("./cover.ts");
  
  const paths = getSpotifyLocalFilePaths();
  const results = [];

  for (const filePath of paths) {
    const metadata = await extractMetadata(filePath);
    if (metadata) {
      results.push(metadata);
    }
  }

  return results;
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
 * Extract all file paths from Spotify's local-files.bnk database.
 * Simply finds paths starting with /Users/ and ending with audio extensions.
 */
export function getSpotifyLocalFilePaths(): string[] {
  // Start watchers on first call
  startBnkWatchers();

  // Check if file has changed
  const currentMtime = getBnkMtime();
  if (currentMtime !== lastBnkMtime) {
    spotifyFilePathsCache = null;
    lastBnkMtime = currentMtime;
  }

  // Return cached result if valid
  if (spotifyFilePathsCache) {
    return spotifyFilePathsCache;
  }

  const paths: string[] = [];
  const spotifyUsersPath = path.join(
    process.env.HOME || "",
    "Library/Application Support/Spotify/Users",
  );

  const audioExtensions = [".mp3", ".m4a", ".flac", ".wav", ".ogg", ".opus", ".aac", ".wma"];

  try {
    if (!existsSync(spotifyUsersPath)) {
      return paths;
    }

    const userDirs = readdirSync(spotifyUsersPath, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const userDir of userDirs) {
      const bnkPath = path.join(spotifyUsersPath, userDir, "local-files.bnk");
      if (!existsSync(bnkPath)) continue;

      const buffer = readFileSync(bnkPath);
      const usersPattern = Buffer.from("/Users/");

      let i = 0;
      while (i < buffer.length - 20) {
        const idx = buffer.indexOf(usersPattern, i);
        if (idx === -1) break;

        // Find end of path by looking for audio extension
        let pathEnd = idx;
        for (let j = idx; j < Math.min(idx + 300, buffer.length); j++) {
          const slice = buffer.subarray(j, Math.min(j + 5, buffer.length)).toString("utf-8").toLowerCase();
          for (const ext of audioExtensions) {
            if (slice.startsWith(ext)) {
              pathEnd = j + ext.length;
              break;
            }
          }
          if (pathEnd > idx) break;
        }

        if (pathEnd > idx) {
          const filePath = buffer.subarray(idx, pathEnd).toString("utf-8");
          if (existsSync(filePath) && !paths.includes(filePath)) {
            paths.push(filePath);
          }
          i = pathEnd;
        } else {
          i = idx + 1;
        }
      }
    }
  } catch (err) {
    console.error("[local-files] Error parsing Spotify database:", err);
  }

  spotifyFilePathsCache = paths;
  console.log(`[local-files] Found ${paths.length} files in Spotify database`);
  return paths;
}

interface MatchResult {
  path: string;
  score: number;
}

/**
 * Strip parentheses/brackets content and leading track numbers from a string
 */
function stripExtra(str: string): string {
  return str
    .replace(/\s*[\(\[].*?[\)\]]/g, "") // Remove (feat...), [V1], etc.
    .replace(/^\d+[\s.\-_]*/g, "")      // Remove leading "01. ", "19. ", etc.
    .trim();
}

/**
 * Create multiple normalized variants for matching
 * Handles cases like "Arm & Leg" vs "ArmLeg" 
 */
function getNormalizedVariants(str: string): string[] {
  const variants: string[] = [];
  
  // Basic normalized
  const norm = normalizeForMatch(str);
  variants.push(norm);
  
  // Without "and" (for & -> and conversion issues)
  const noAnd = norm.replace(/and/g, "");
  if (noAnd !== norm && noAnd.length >= 3) {
    variants.push(noAnd);
  }
  
  // Stripped version
  const stripped = normalizeForMatch(stripExtra(str));
  if (stripped !== norm) {
    variants.push(stripped);
    const strippedNoAnd = stripped.replace(/and/g, "");
    if (strippedNoAnd !== stripped && strippedNoAnd.length >= 3) {
      variants.push(strippedNoAnd);
    }
  }
  
  return [...new Set(variants)]; // Dedupe
}

/**
 * Find a local file by matching title/artist against filenames.
 * Searches Spotify's known file paths.
 */
export function findFileFromSpotifyDb(
  title: string,
  artist?: string,
  album?: string,
): string | null {
  const files = getSpotifyLocalFilePaths();

  // Create multiple normalized variants for matching
  const titleVariants = getNormalizedVariants(title);
  const artistNorm = artist ? normalizeForMatch(artist) : "";

  const matches: MatchResult[] = [];

  for (const filePath of files) {
    const fileName = path.basename(filePath, path.extname(filePath));
    const fileVariants = getNormalizedVariants(fileName);

    let score = 0;
    let matched = false;

    // Check all combinations of title and file variants
    for (const titleVar of titleVariants) {
      for (const fileVar of fileVariants) {
        // Exact match
        if (fileVar === titleVar) {
          score = Math.max(score, 100);
          matched = true;
        }
        // File contains title or title contains file
        else if (titleVar.length >= 3 && fileVar.length >= 3) {
          if (fileVar.includes(titleVar)) {
            score = Math.max(score, 85);
            matched = true;
          } else if (titleVar.includes(fileVar)) {
            score = Math.max(score, 80);
            matched = true;
          }
        }
      }
    }

    // Check if filename contains both artist and title
    if (!matched && artistNorm) {
      const fileNorm = fileVariants[0];
      for (const titleVar of titleVariants) {
        if (fileNorm.includes(artistNorm) && fileNorm.includes(titleVar)) {
          score = Math.max(score, 90);
          matched = true;
          break;
        }
      }
    }

    if (matched) {
      // Bonus for artist in filename
      if (artistNorm && fileVariants[0].includes(artistNorm)) {
        score += 20;
      }
      // Bonus for high quality
      const ext = path.extname(filePath).toLowerCase();
      if (ext === ".flac" || ext === ".wav") {
        score += 5;
      }
      matches.push({ path: filePath, score });
    }
  }

  matches.sort((a, b) => b.score - a.score);

  if (matches.length > 0) {
    console.log(`[local-files] Found "${title}" -> ${matches[0].path} (score: ${matches[0].score})`);
    return matches[0].path;
  }

  return null;
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

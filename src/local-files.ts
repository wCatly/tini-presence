import { exec } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  watch,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

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
  "Users"
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

// Cache for Spotify's local files database
let spotifyLocalFilesCache: Map<string, string> | null = null;
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
      const bnkPath = path.join(SPOTIFY_USERS_PATH, userDir, "local-files.bnk");
      const userPath = path.join(SPOTIFY_USERS_PATH, userDir);

      // Watch the directory for file creation/changes
      try {
        watch(userPath, (event, filename) => {
          if (filename === "local-files.bnk") {
            spotifyLocalFilesCache = null; // Invalidate cache
          }
        });
      } catch {
        // Ignore watch errors
      }
    }

    // Also watch the Users directory for new user folders
    try {
      watch(SPOTIFY_USERS_PATH, () => {
        spotifyLocalFilesCache = null; // Invalidate cache on any change
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

  try {
    if (!existsSync(SPOTIFY_USERS_PATH)) {
      return fileMap;
    }

    // Find all user directories
    const userDirs = readdirSync(SPOTIFY_USERS_PATH, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const userDir of userDirs) {
      const bnkPath = path.join(SPOTIFY_USERS_PATH, userDir, "local-files.bnk");
      if (!existsSync(bnkPath)) continue;

      // Read the binary file
      const buffer = readFileSync(bnkPath);
      const content = buffer.toString("utf-8");

      // Extract file paths - they start with / and end with common audio extensions
      // Use RegExp constructor to avoid control character issues in literal
      const pathRegex = new RegExp(
        "(\\/[^\\x00-\\x1f]+?\\.(mp3|m4a|flac|wav|ogg|opus|aac|wma))",
        "gi"
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

/**
 * Find a local file path from Spotify's database by matching title.
 */
export function findFileFromSpotifyDb(title: string): string | null {
  const db = parseSpotifyLocalFilesDb();
  const normalizedTitle = title.toLowerCase();

  // Direct match
  if (db.has(normalizedTitle)) {
    const filePath = db.get(normalizedTitle)!;
    if (existsSync(filePath)) {
      return filePath;
    }
  }

  // Fuzzy match - find entries containing the title
  for (const [key, filePath] of db) {
    if (key.includes(normalizedTitle) || normalizedTitle.includes(key)) {
      if (existsSync(filePath)) {
        return filePath;
      }
    }
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

// Find local file by searching Spotify's database first, then configured folders
export function findLocalFile(trackId: string): string | null {
  const info = parseLocalTrackInfo(trackId);
  if (!info) return null;

  const { artist, album, title } = info;

  // Try Spotify's local files database first (most reliable)
  const fromDb = findFileFromSpotifyDb(title);
  if (fromDb) return fromDb;

  // Fallback to configured folders search
  const folders = getMusicFolders();
  const extensions = [".mp3", ".m4a", ".flac", ".wav", ".ogg", ".opus"];

  for (const folder of folders) {
    // Try various path patterns
    const patterns = [
      // Artist/Album/Title
      path.join(folder, artist, album, title),
      // Artist/Title
      path.join(folder, artist, title),
      // Album/Title
      path.join(folder, album, title),
      // Just Title in folder
      path.join(folder, title),
    ];

    for (const pattern of patterns) {
      for (const ext of extensions) {
        const filePath = pattern + ext;
        if (existsSync(filePath)) {
          return filePath;
        }
      }
    }
  }

  // Fallback: recursive search (slower but more thorough)
  for (const folder of folders) {
    const found = searchRecursive(folder, title, extensions);
    if (found) return found;
  }

  return null;
}

function searchRecursive(
  dir: string,
  title: string,
  extensions: string[],
  depth = 0
): string | null {
  if (depth > 4) return null;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    // First, look for direct file matches in this directory
    for (const entry of entries) {
      if (entry.isFile()) {
        const name = entry.name.toLowerCase();
        if (name.includes(title.toLowerCase())) {
          if (extensions.some((ext) => name.endsWith(ext))) {
            return path.join(dir, entry.name);
          }
        }
      }
    }

    // If not found, recurse into subdirectories
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Skip hidden folders and common massive/system folders
        if (
          entry.name.startsWith(".") ||
          ["node_modules", "Library", "System", "Applications"].includes(
            entry.name
          )
        ) {
          continue;
        }

        const found = searchRecursive(
          path.join(dir, entry.name),
          title,
          extensions,
          depth + 1
        );
        if (found) return found;
      }
    }
  } catch (err) {
    // Silently ignore permission errors (EACCES) or non-existent paths
    // This prevents the system from being noisy if we hit a restricted subfolder
  }

  return null;
}

export class LocalFileFinder {
  async promptAddFolder(): Promise<string | null> {
    return addMusicFolder();
  }

  getFolders(): string[] {
    return getMusicFolders();
  }

  removeFolder(folder: string): void {
    removeMusicFolder(folder);
  }

  findFile(trackId: string): string | null {
    return findLocalFile(trackId);
  }
}

export const localFiles = new LocalFileFinder();

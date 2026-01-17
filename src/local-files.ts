import { exec } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const CONFIG_PATH = path.join(homedir(), ".config", "tini-presence", "config.json");

export interface LocalFilesConfig {
  musicFolders: string[];
}

function ensureConfigDir(): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!existsSync(dir)) {
    Bun.spawnSync(["mkdir", "-p", dir]);
  }
}

export function loadConfig(): LocalFilesConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const data = readFileSync(CONFIG_PATH, "utf-8");
      return JSON.parse(data);
    }
  } catch {
    // Ignore errors
  }
  return { musicFolders: [] };
}

export function saveConfig(config: LocalFilesConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
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

// Find local file by searching configured folders
export function findLocalFile(trackId: string): string | null {
  const info = parseLocalTrackInfo(trackId);
  if (!info) return null;

  const { artist, album, title } = info;
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
  extensions: string[]
): string | null {
  try {
    const result = Bun.spawnSync([
      "find",
      dir,
      "-type",
      "f",
      "-maxdepth",
      "4",
      "-name",
      `*${title}*`,
    ]);

    const output = result.stdout.toString().trim();
    if (!output) return null;

    const files = output.split("\n");
    for (const file of files) {
      if (extensions.some((ext) => file.toLowerCase().endsWith(ext))) {
        return file;
      }
    }
  } catch {
    // Ignore search errors
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

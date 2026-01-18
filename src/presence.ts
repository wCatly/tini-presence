/**
 * Presence Service
 *
 * Orchestrates the full flow for Discord Rich Presence:
 * 1. Find local file from Spotify track
 * 2. Extract cover art
 * 3. Upload to CDN
 * 4. Return URL for Discord
 */

import { ActivityType } from "discord-api-types/v10";
import { extractCoverArt, getExtension, getFolderName } from "./cover.ts";
import { getConfig, localFiles, type AppConfig } from "./local-files.ts";
import { UploadService, type UploadConfig } from "./upload.ts";
import type { SpotifyState, Track } from "./spotify.ts";

export interface PresenceConfig {
  upload?: UploadConfig;
}

export interface CoverResult {
  url: string;
  cached: boolean;
}

export class PresenceService {
  private uploadService: UploadService | null = null;
  // Cache cover URLs by track ID to avoid repeated HEAD requests
  private coverUrlCache: Map<string, string | null> = new Map();
  private unsubscribe: (() => void) | null = null;
  // Cache last activity to avoid unnecessary Discord updates
  private lastActivityKey: string | null = null;
  private lastActivityTimestamps: { start: number; end: number } | null = null;

  constructor(config: PresenceConfig) {
    if (config.upload) {
      this.uploadService = new UploadService(config.upload);
    }

    // Subscribe to music folder changes AND Spotify database changes to clear cache
    // This ensures newly added files are detected
    this.unsubscribe = localFiles.onChange(() => {
      console.log("[presence] Local files changed, clearing cover URL cache");
      this.coverUrlCache.clear();
      // Also reset the activity cache to force Discord update
      this.lastActivityKey = null;
      this.lastActivityTimestamps = null;
    });
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /**
   * Get cover art URL for a track
   * Returns null if:
   * - Track is not local
   * - No upload service configured
   * - File not found
   * - No cover art in file
   * - Upload failed
   *
   * Results are cached by track ID to avoid repeated requests.
   */
  async getCoverUrl(track: Track): Promise<string | null> {
    // For non-local tracks, return artworkUrl if available
    if (track.source !== "local") {
      return track.artworkUrl ?? null;
    }

    if (!this.uploadService) {
      if (track.artworkUrl) {
        console.log(`[presence] Upload disabled, using Spotify artwork for ${track.title}`);
        return track.artworkUrl;
      }
      return null;
    }

    // Check cache first
    if (this.coverUrlCache.has(track.id)) {
      const cached = this.coverUrlCache.get(track.id);
      console.log(
        `[presence] Cache hit for ${track.title}: ${cached ? "found" : "none"}`,
      );
      return cached ?? null;
    }

    // Find the local file
    const filePath = localFiles.findFile(track.id);
    if (!filePath) {
      console.log(`[presence] File not found: ${track.title}`);
      this.coverUrlCache.set(track.id, null);
      return null;
    }

    // Extract cover art
    console.log(`[presence] Found file: ${filePath}. Extracting artwork...`);
    const cover = await extractCoverArt(filePath);
    if (!cover) {
      console.log(`[presence] No cover art found inside file: ${track.title}`);
      this.coverUrlCache.set(track.id, null);
      return null;
    }
    console.log(
      `[presence] Artwork extracted: ${cover.mimeType}, ${Math.round(cover.data.length / 1024)}KB`,
    );

    // Upload with organized path (skips if already exists)
    try {
      const result = await this.uploadService.uploadCover(
        cover.data,
        cover.mimeType,
        {
          songTitle: track.title,
          folderName: getFolderName(filePath),
          hash: cover.hash,
          extension: getExtension(cover.mimeType),
        },
      );

      if (result.existed) {
        console.log(`[presence] Cover exists: ${result.url}`);
      } else {
        console.log(`[presence] Cover uploaded: ${result.url}`);
      }

      this.coverUrlCache.set(track.id, result.url);
      return result.url;
    } catch (err) {
      console.error(`[presence] Upload failed:`, err);
      this.coverUrlCache.set(track.id, null);
      return null;
    }
  }

  buildActivity(state: SpotifyState, coverUrl: string | null) {
    if (!state.isRunning || state.state !== "playing") {
      this.lastActivityKey = null;
      this.lastActivityTimestamps = null;
      return null;
    }

    const { track, positionMs } = state;
    const now = Date.now();
    
    // Always calculate fresh timestamps based on current position
    const startTimestamp = now - positionMs;
    const endTimestamp = now + (track.durationMs - positionMs);
    
    // Update cache
    this.lastActivityKey = `${track.id}:${coverUrl || "none"}`;
    this.lastActivityTimestamps = { start: startTimestamp, end: endTimestamp };

    return {
      type: ActivityType.Listening,
      name: "Spotify",
      details: track.title,
      state: track.artist,
      startTimestamp,
      endTimestamp,
      largeImageKey: coverUrl || "spotify",
      largeImageText: track.album,
      smallImageKey: track.source === "local" ? "local" : "spotify-small",
      smallImageText: track.source === "local" ? "Local File" : "Spotify",
      instance: false,
    };
  }

  /**
   * Get configured music folders
   */
  getMusicFolders(): string[] {
    return localFiles.getFolders();
  }

  /**
   * Add a music folder via Finder picker
   */
  async addMusicFolder(): Promise<string | null> {
    return localFiles.promptAddFolder();
  }

  /**
   * Check if upload is configured
   */
  get hasUpload(): boolean {
    return this.uploadService !== null;
  }
}

/**
 * Create presence service from environment variables
 */
export function createPresenceService(
  configOverride?: AppConfig,
): PresenceService {
  const fileConfig = configOverride ?? getConfig();
  const apiKey = fileConfig.copypartyApiKey || process.env.COPYPARTY_API_KEY;

  const config: PresenceConfig = {};

  if (apiKey) {
    config.upload = {
      baseUrl:
        fileConfig.copypartyUrl ||
        process.env.COPYPARTY_URL ||
        "https://pifiles.florian.lt",
      uploadPath:
        fileConfig.copypartyPath || process.env.COPYPARTY_PATH || "/cdn",
      apiKey,
    };
  }

  return new PresenceService(config);
}

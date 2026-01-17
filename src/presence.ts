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
import { localFiles } from "./local-files.ts";
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

  constructor(config: PresenceConfig) {
    if (config.upload) {
      this.uploadService = new UploadService(config.upload);
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
   */
  async getCoverUrl(track: Track): Promise<string | null> {
    // Only handle local files
    if (track.source !== "local") {
      return null;
    }

    if (!this.uploadService) {
      return null;
    }

    // Find the local file
    const filePath = localFiles.findFile(track.id);
    if (!filePath) {
      console.log(`[presence] File not found: ${track.title}`);
      return null;
    }

    // Extract cover art
    const cover = await extractCoverArt(filePath);
    if (!cover) {
      console.log(`[presence] No cover art: ${track.title}`);
      return null;
    }

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
        }
      );
      
      if (result.existed) {
        console.log(`[presence] Cover exists: ${result.url}`);
      } else {
        console.log(`[presence] Cover uploaded: ${result.url}`);
      }
      return result.url;
    } catch (err) {
      console.error(`[presence] Upload failed:`, err);
      return null;
    }
  }

  /**
   * Build Discord activity from Spotify state
   * Only shows presence for LOCAL files (not streaming tracks)
   * Uses ActivityType.Listening for Spotify-like display with progress bar
   */
  buildActivity(state: SpotifyState, coverUrl: string | null) {
    if (!state.isRunning || state.state !== "playing") {
      return null;
    }

    const { track, positionMs } = state;

    // Only show presence for local files
    if (track.source !== "local") {
      return null;
    }

    const now = Date.now();

    return {
      type: ActivityType.Listening,
      name: "Spotify",
      details: track.title,
      state: track.artist,
      startTimestamp: now - positionMs,
      endTimestamp: now + (track.durationMs - positionMs),
      largeImageKey: coverUrl || "spotify",
      largeImageText: track.album,
      smallImageKey: "local",
      smallImageText: "Local File",
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
export function createPresenceService(): PresenceService {
  const apiKey = process.env.COPYPARTY_API_KEY;
  
  const config: PresenceConfig = {};
  
  if (apiKey) {
    config.upload = {
      baseUrl: process.env.COPYPARTY_URL || "https://pifiles.florian.lt",
      uploadPath: process.env.COPYPARTY_PATH || "/cdn",
      apiKey,
    };
  }

  return new PresenceService(config);
}

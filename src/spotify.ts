import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export type PlayerState = "playing" | "paused" | "stopped";

export type TrackSource = "spotify" | "local";

export interface Track {
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  id: string;
  source: TrackSource;
  artworkUrl?: string;
}

export interface PlaybackState {
  isRunning: true;
  track: Track;
  positionMs: number;
  state: PlayerState;
}

export interface NotRunningState {
  isRunning: false;
}

export type SpotifyState = PlaybackState | NotRunningState;

const APPLESCRIPT_LINES = [
  'tell application "Spotify"',
  "if it is running then",
  "set trackName to name of current track",
  "set trackArtist to artist of current track",
  "set trackAlbum to album of current track",
  "set trackDuration to duration of current track",
  "set trackPos to player position",
  "set trackState to player state as string",
  "set trackId to id of current track",
  "set trackArtworkUrl to artwork url of current track",
  'return trackName & "||" & trackArtist & "||" & trackAlbum & "||" & trackDuration & "||" & trackPos & "||" & trackState & "||" & trackId & "||" & trackArtworkUrl',
  "else",
  'return "NOT_RUNNING"',
  "end if",
  "end tell",
];

function parseNumber(value: string): number {
  return Number(value.replace(",", "."));
}

function parsePlayerState(value: string): PlayerState {
  if (value === "playing" || value === "paused" || value === "stopped") {
    return value;
  }
  return "stopped";
}

function parseTrackSource(trackId: string): TrackSource {
  return trackId.startsWith("spotify:local:") ? "local" : "spotify";
}

export async function getSpotifyState(): Promise<SpotifyState> {
  const args = APPLESCRIPT_LINES.map((line) => `-e '${line}'`).join(" ");
  const { stdout } = await execAsync(`osascript ${args}`);
  const out = stdout.trim();

  if (!out || out === "NOT_RUNNING") {
    return { isRunning: false };
  }

  const [
    title,
    artist,
    album,
    durationMs,
    positionSec,
    state,
    trackId,
    artworkUrl,
  ] = out.split("||");

  return {
    isRunning: true,
    track: {
      title,
      artist,
      album,
      durationMs: parseNumber(durationMs),
      id: trackId,
      source: parseTrackSource(trackId),
      artworkUrl:
        artworkUrl && artworkUrl !== "missing value" ? artworkUrl : undefined,
    },
    positionMs: parseNumber(positionSec) * 1000,
    state: parsePlayerState(state),
  };
}

export class SpotifyClient {
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  async getState(): Promise<SpotifyState> {
    return getSpotifyState();
  }

  async getCurrentTrack(): Promise<Track | null> {
    const state = await this.getState();
    return state.isRunning ? state.track : null;
  }

  async isPlaying(): Promise<boolean> {
    const state = await this.getState();
    return state.isRunning && state.state === "playing";
  }

  onStateChange(
    callback: (state: SpotifyState) => void,
    intervalMs: number = 1000
  ): () => void {
    let lastState: string | null = null;

    this.pollInterval = setInterval(async () => {
      try {
        const state = await this.getState();
        const stateKey = JSON.stringify(state);

        if (stateKey !== lastState) {
          lastState = stateKey;
          callback(state);
        }
      } catch {
        // Ignore polling errors
      }
    }, intervalMs);

    return () => this.stopPolling();
  }

  poll(
    callback: (state: SpotifyState) => void,
    intervalMs: number = 1000
  ): () => void {
    this.pollInterval = setInterval(async () => {
      try {
        const state = await this.getState();
        callback(state);
      } catch {
        // Ignore polling errors
      }
    }, intervalMs);

    return () => this.stopPolling();
  }

  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}

export const spotify = new SpotifyClient();

/**
 * tini-presence
 *
 * Discord Rich Presence for Spotify with local file support
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@xhayper/discord-rpc";
import { spotify, type SpotifyState } from "./src/spotify.ts";
import { createPresenceService } from "./src/presence.ts";
import {
  getConfigPath,
  getConfig,
  updateConfig,
  findLocalFile,
  localFiles,
  type AppConfig,
} from "./src/local-files.ts";
import { getImageOptimizerStatus } from "./src/cover.ts";
import { logger, acquireLock, LOG_DIR_PATH } from "./src/logger.ts";

// Acquire lock to prevent multiple instances
if (!acquireLock()) {
  logger.error("Failed to acquire lock, another instance may be running. Exiting.");
  process.exit(1);
}

// Override console methods to use file logger
console.log = (...args: unknown[]) => logger.log(...args);
console.warn = (...args: unknown[]) => logger.warn(...args);
console.error = (...args: unknown[]) => logger.error(...args);

async function writeStartupDiagnostics() {
  try {
    const diagnostics = {
      timestamp: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      bunVersion: Bun.version,
      pid: process.pid,
      logDir: LOG_DIR_PATH,
      config: {
        musicFolders: getConfig().musicFolders.length,
        hasDiscordClientId: Boolean(getConfig().discordClientId),
      },
      optimizers: await getImageOptimizerStatus(),
    };

    const filePath = join(LOG_DIR_PATH, "startup.json");
    writeFileSync(filePath, JSON.stringify(diagnostics, null, 2));
  } catch (err) {
    logger.warn("[startup] Failed to write diagnostics:", err);
  }
}

await writeStartupDiagnostics();

let config = getConfig();
let clientId =
  config.discordClientId || process.env.DISCORD_CLIENT_ID || "YOUR_CLIENT_ID";

const rpc = new Client({ clientId });
let presence = createPresenceService(config);

function refreshPresence(nextConfig: AppConfig) {
  if (presence) presence.destroy();
  presence = createPresenceService(nextConfig);
  if (nextConfig.discordClientId && nextConfig.discordClientId !== clientId) {
    clientId = nextConfig.discordClientId;
    console.warn("Discord client ID changed. Restart the app to reconnect.");
  }
}

interface TrackStatus {
  playing: boolean;
  reason?: string;
  title?: string;
  artist?: string;
  album?: string;
  coverUrl?: string | null;
  source?: string;
  positionMs?: number;
  durationMs?: number;
  trackId?: string;
  filePath?: string | null;
}

interface ProtocolMessage {
  type: "status" | "config" | "heartbeat";
  payload: TrackStatus | AppConfig | { timestamp: number };
}

interface CommandMessage {
  type: "command";
  command: "get-config" | "update-config" | "add-folder" | "open-config";
  payload?: Partial<AppConfig>;
}

function emitStatus(status: TrackStatus) {
  const message: ProtocolMessage = { type: "status", payload: status };
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function emitConfig(configPayload: AppConfig) {
  const message: ProtocolMessage = { type: "config", payload: configPayload };
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function emitHeartbeat() {
  const message: ProtocolMessage = { type: "heartbeat", payload: { timestamp: Date.now() } };
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

// Send heartbeat every 5 seconds
setInterval(emitHeartbeat, 5000);

async function handleCommand(message: CommandMessage) {
  switch (message.command) {
    case "get-config":
      console.log("[sidecar] get-config");
      emitConfig(config);
      break;
    case "update-config": {
      const next = updateConfig(message.payload ?? {});
      config = next;
      refreshPresence(next);
      emitConfig(next);
      break;
    }
    case "add-folder": {
      await presence.addMusicFolder();
      config = getConfig();
      emitConfig(config);
      break;
    }
    case "open-config":
      Bun.spawnSync(["open", getConfigPath()]);
      break;
    default:
      break;
  }
}

// Handle --add-folder flag
if (process.argv.includes("--add-folder")) {
  const folder = await presence.addMusicFolder();
  if (folder) {
    console.log(`Added folder: ${folder}`);
  } else {
    console.log("No folder selected.");
  }
  process.exit(0);
}

// Listen for commands from stdin
process.stdin.setEncoding("utf-8");
let stdinBuffer = "";
process.stdin.on("data", (chunk) => {
  stdinBuffer += chunk;
  let newlineIndex = stdinBuffer.indexOf("\n");
  while (newlineIndex !== -1) {
    const line = stdinBuffer.slice(0, newlineIndex).trim();
    stdinBuffer = stdinBuffer.slice(newlineIndex + 1);
    newlineIndex = stdinBuffer.indexOf("\n");

    if (!line) continue;
    try {
      const message = JSON.parse(line) as CommandMessage;
      if (message.type === "command") {
        void handleCommand(message);
      }
    } catch (error) {
      console.error("Failed to parse command:", error);
    }
  }
});

process.stdin.on("end", () => {
  console.warn("[sidecar] stdin closed; staying alive");
});

process.stdin.on("close", () => {
  console.warn("[sidecar] stdin closed; staying alive");
});

process.stdin.resume();

emitConfig(config);
console.log(`[sidecar] booted (log dir: ${LOG_DIR_PATH})`);

// Show configured folders
const folders = presence.getMusicFolders();
if (folders.length === 0) {
  console.log("No music folders configured.");
  console.log("Run with --add-folder to add a music folder.");
} else {
  console.log("Music folders:", folders);
}

if (!presence.hasUpload) {
  console.log("Warning: COPYPARTY_API_KEY not set, cover art upload disabled.");
}

// Update Discord presence
async function updatePresence(state: SpotifyState) {
  if (!state.isRunning) {
    if (lastSentActivityKey !== "cleared:not-running") {
      await rpc.user?.clearActivity();
      lastSentActivityKey = "cleared:not-running";
      console.log("Cleared presence - Spotify not running");
    }
    emitStatus({ playing: false, reason: "spotify-not-running" });
    return;
  }

  // Get cover URL for local files
  const coverUrl = await presence.getCoverUrl(state.track);

  // Build activity
  const activity = presence.buildActivity(state, coverUrl);

  // Get local file path if it's a local track
  const filePath = state.track.source === "local" ? findLocalFile(state.track.id) : null;

  if (activity) {
    // Always update Discord activity - it handles deduplication internally
    // This ensures seeks, position changes, etc. are reflected
    await rpc.user?.setActivity(activity);
    
    const activityKey = `playing:${state.track.id}:${coverUrl || "none"}`;
    if (activityKey !== lastSentActivityKey) {
      lastSentActivityKey = activityKey;
      console.log(`Playing: ${state.track.title} - ${state.track.artist}`);
    }
    
    emitStatus({
      playing: true,
      title: state.track.title,
      artist: state.track.artist,
      album: state.track.album,
      coverUrl,
      source: state.track.source,
      positionMs: state.positionMs,
      durationMs: state.track.durationMs,
      trackId: state.track.id,
      filePath,
    });
  } else {
    await rpc.user?.clearActivity();
    
    if (lastSentActivityKey !== "cleared:not-playing") {
      lastSentActivityKey = "cleared:not-playing";
      console.log("Cleared presence - not playing");
    }
    emitStatus({
      playing: false,
      reason: "not-playing",
      title: state.track.title,
      artist: state.track.artist,
      album: state.track.album,
      coverUrl,
      source: state.track.source,
      positionMs: state.positionMs,
      durationMs: state.track.durationMs,
      trackId: state.track.id,
      filePath,
    });
  }
}

// Discord connection state
let isConnected = false;
let reconnectTimeout: Timer | null = null;
// Track last sent activity to avoid redundant Discord API calls
let lastSentActivityKey: string | null = null;

// Listen for local file changes to reset Discord activity
localFiles.onChange(() => {
  console.log("[sidecar] Local files changed, resetting activity key");
  lastSentActivityKey = null;
});

async function connectToDiscord() {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  try {
    console.log("[sidecar] Connecting to Discord...");
    await rpc.login();
  } catch (err: unknown) {
    console.error(
      "[sidecar] Failed to connect to Discord, retrying in 5s...",
      err,
    );
    emitStatus({ playing: false, reason: "discord-not-running" });
    reconnectTimeout = setTimeout(connectToDiscord, 5000);
  }
}

// Connect to Discord
rpc.on("ready", () => {
  isConnected = true;
  console.log(`Connected to Discord as ${rpc.user?.username}`);
  emitStatus({ playing: false, reason: "idle" });
  emitConfig(getConfig());
});

rpc.on("disconnected", () => {
  isConnected = false;
  console.warn("[sidecar] Disconnected from Discord, retrying in 5s...");
  reconnectTimeout = setTimeout(connectToDiscord, 5000);
});

// Start initial connection
void connectToDiscord();

// Poll Spotify and update presence
spotify.onStateChange(async (state: SpotifyState) => {
  if (!isConnected) return;
  try {
    await updatePresence(state);
  } catch (err) {
    console.error("Failed to update presence:", err);
  }
}, 1000);

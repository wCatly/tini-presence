/**
 * tini-presence
 *
 * Discord Rich Presence for Spotify with local file support
 */

import { Client } from "@xhayper/discord-rpc";
import { spotify, type SpotifyState } from "./src/spotify.ts";
import { createPresenceService } from "./src/presence.ts";
import {
  getConfigPath,
  getConfig,
  updateConfig,
  type AppConfig,
} from "./src/local-files.ts";

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

const logToStderr = (args: unknown[]) => {
  process.stderr.write(`${args.map(String).join(" ")}\n`);
};

console.log = (...args: unknown[]) => logToStderr(args);
console.warn = (...args: unknown[]) => logToStderr(args);
console.error = (...args: unknown[]) => logToStderr(args);

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
}

interface ProtocolMessage {
  type: "status" | "config";
  payload: TrackStatus | AppConfig;
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

emitConfig(config);
console.log("[sidecar] booted");

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
    await rpc.user?.clearActivity();
    console.log("Cleared presence - Spotify not running");
    emitStatus({ playing: false, reason: "spotify-not-running" });
    return;
  }

  // Get cover URL for local files
  const coverUrl = await presence.getCoverUrl(state.track);

  // Build activity
  const activity = presence.buildActivity(state, coverUrl);

  if (activity) {
    await rpc.user?.setActivity(activity);
    console.log(`Playing: ${state.track.title} - ${state.track.artist}`);
    emitStatus({
      playing: true,
      title: state.track.title,
      artist: state.track.artist,
      album: state.track.album,
      coverUrl,
      source: state.track.source,
      positionMs: state.positionMs,
      durationMs: state.track.durationMs,
    });
  } else {
    await rpc.user?.clearActivity();
    console.log("Cleared presence - not playing");
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
    });
  }
}

// Discord connection state
let isConnected = false;
let reconnectTimeout: Timer | null = null;

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

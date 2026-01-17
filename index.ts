/**
 * tini-presence
 * 
 * Discord Rich Presence for Spotify with local file support
 */

import { Client } from "@xhayper/discord-rpc";
import { spotify, type SpotifyState } from "./src/spotify.ts";
import { createPresenceService } from "./src/presence.ts";

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || "YOUR_CLIENT_ID";

const rpc = new Client({ clientId: CLIENT_ID });
const presence = createPresenceService();

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
    return;
  }

  // Get cover URL for local files
  const coverUrl = await presence.getCoverUrl(state.track);

  // Build activity
  const activity = presence.buildActivity(state, coverUrl);

  if (activity) {
    await rpc.user?.setActivity(activity);
    console.log(`Playing: ${state.track.title} - ${state.track.artist}`);
  } else {
    await rpc.user?.clearActivity();
    console.log("Cleared presence - not playing");
  }
}

// Connect to Discord
rpc.on("ready", () => {
  console.log(`Connected to Discord as ${rpc.user?.username}`);

  // Poll Spotify and update presence
  spotify.onStateChange(async (state: SpotifyState) => {
    try {
      await updatePresence(state);
    } catch (err) {
      console.error("Failed to update presence:", err);
    }
  }, 1000);
});

rpc.login().catch(console.error);

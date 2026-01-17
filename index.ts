import { Client } from "@xhayper/discord-rpc";

import { extractCoverArt, getCoverFilename } from "./src/cover.ts";
import { localFiles } from "./src/local-files.ts";
import { spotify, type SpotifyState } from "./src/spotify.ts";
import { UploadService } from "./src/upload.ts";

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || "YOUR_CLIENT_ID";
const COPYPARTY_URL = process.env.COPYPARTY_URL || "https://pifiles.florian.lt";
const COPYPARTY_API_KEY = process.env.COPYPARTY_API_KEY || "";

const rpc = new Client({ clientId: CLIENT_ID });

const uploadService = COPYPARTY_API_KEY
  ? new UploadService({
      baseUrl: COPYPARTY_URL,
      uploadPath: process.env.COPYPARTY_PATH || "/cdn",
      apiKey: COPYPARTY_API_KEY,
    })
  : null;

async function getCoverUrl(state: SpotifyState): Promise<string | null> {
  if (!state.isRunning || !uploadService) return null;

  const { track } = state;

  if (track.source !== "local") return null;

  const filePath = localFiles.findFile(track.id);
  if (!filePath) {
    console.log(`Could not find local file for: ${track.title}`);
    return null;
  }

  console.log(`Found local file: ${filePath}`);

  const cover = await extractCoverArt(filePath);
  if (!cover) {
    console.log(`No cover art found in: ${filePath}`);
    return null;
  }

  try {
    const filename = getCoverFilename(cover);
    const result = await uploadService.uploadCached(
      cover.data,
      filename,
      cover.mimeType,
      cover.hash
    );
    return result.url;
  } catch (err) {
    console.error("Failed to upload cover:", err);
    return null;
  }
}

async function updatePresence(state: SpotifyState) {
  if (!state.isRunning || state.state !== "playing") {
    await rpc.user?.clearActivity();
    console.log("Cleared presence - Spotify not playing");
    return;
  }

  const { track, positionMs } = state;
  const now = Date.now();
  const startTimestamp = now - positionMs;
  const endTimestamp = now + (track.durationMs - positionMs);

  let largeImageKey = "spotify";

  if (track.source === "local") {
    const coverUrl = await getCoverUrl(state);
    if (coverUrl) {
      largeImageKey = coverUrl;
      console.log(`Using cover art: ${coverUrl}`);
    }
  }

  await rpc.user?.setActivity({
    details: track.title,
    state: `by ${track.artist}`,
    startTimestamp,
    endTimestamp,
    largeImageKey,
    largeImageText: track.album,
    smallImageKey: track.source === "local" ? "local" : "spotify",
    smallImageText: track.source === "local" ? "Local File" : "Spotify",
    instance: false,
  });

  console.log(`Playing: ${track.title} - ${track.artist}`);
}

// Check if music folders are configured
const folders = localFiles.getFolders();
if (folders.length === 0) {
  console.log("No music folders configured.");
  console.log("Run with --add-folder to add a music folder.");

  if (process.argv.includes("--add-folder")) {
    const folder = await localFiles.promptAddFolder();
    if (folder) {
      console.log(`Added folder: ${folder}`);
    } else {
      console.log("No folder selected.");
    }
  }
} else {
  console.log("Music folders:", folders);
}

if (process.argv.includes("--add-folder")) {
  process.exit(0);
}

rpc.on("ready", () => {
  console.log(`Discord RPC connected as ${rpc.user?.username}`);

  spotify.onStateChange(async (state: SpotifyState) => {
    try {
      await updatePresence(state);
    } catch (err) {
      console.error("Failed to update presence:", err);
    }
  }, 1000);
});

rpc.login().catch(console.error);

import {
  findLocalFile,
  parseLocalTrackInfo,
  parseSpotifyLocalFilesDb,
  normalizeString,
} from "./src/local-files.ts";
import { extractCoverArt } from "./src/cover.ts";

const trackId =
  "spotify:local:Playboi+Carti%2C+Lil+Uzi+Vert:MUSIC:M%C3%89NAGE+%28with+Lil+Uzi+Vert%29:133";
console.log("Track ID:", trackId);

const info = parseLocalTrackInfo(trackId);
console.log("Parsed Info:", info);

if (info) {
  const titleNorm = normalizeString(info.title);
  const titleNoExtra = normalizeString(info.title, true);
  console.log(`Title Norm: "${titleNorm}"`);
  console.log(`Title No Extra: "${titleNoExtra}"`);

  const db = parseSpotifyLocalFilesDb();
  console.log("\nSearching in Spotify DB...");
  let foundInDb = false;
  for (const [key, value] of db) {
    if (
      key.toLowerCase().includes("menage") ||
      key.toLowerCase().includes("ménage")
    ) {
      console.log(`- DB Key Match: "${key}" -> ${value}`);
    }
  }

  const filePath = findLocalFile(trackId);
  console.log("\nFind Result:", filePath);

  if (filePath) {
    console.log("Extracting artwork...");
    const cover = await extractCoverArt(filePath);
    if (cover) {
      console.log(`Success! ${cover.mimeType}, ${cover.data.length} bytes`);
    } else {
      console.log("No artwork found in file.");
    }
  } else {
    console.log("File not found via findLocalFile.");
  }
}

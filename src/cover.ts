import * as mm from "music-metadata";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

// Discord recommends 512x512 for activity images
// Max size ~256KB to avoid loading issues
const MAX_IMAGE_SIZE = 512;
const MAX_FILE_SIZE = 256 * 1024; // 256KB

export interface CoverArt {
  data: Uint8Array;
  mimeType: string;
  hash: string;
}

export function hashBuffer(buffer: Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

/**
 * Compress and resize image for Discord
 * - Resize to max 512x512
 * - Convert to JPEG for smaller size
 * - Target ~256KB max
 */
async function optimizeImage(data: Uint8Array, mimeType: string): Promise<{ data: Uint8Array; mimeType: string }> {
  try {
    // If already small enough and JPEG, return as-is
    if (data.length <= MAX_FILE_SIZE && mimeType === "image/jpeg") {
      return { data, mimeType };
    }

    // Process with sharp
    let image = sharp(Buffer.from(data));
    const metadata = await image.metadata();

    // Resize if larger than MAX_IMAGE_SIZE
    if (metadata.width && metadata.height) {
      if (metadata.width > MAX_IMAGE_SIZE || metadata.height > MAX_IMAGE_SIZE) {
        image = image.resize(MAX_IMAGE_SIZE, MAX_IMAGE_SIZE, {
          fit: "inside",
          withoutEnlargement: true,
        });
      }
    }

    // Convert to JPEG with quality adjustment
    let quality = 90;
    let result = await image.jpeg({ quality, mozjpeg: true }).toBuffer();

    // If still too large, reduce quality
    while (result.length > MAX_FILE_SIZE && quality > 50) {
      quality -= 10;
      result = await image.jpeg({ quality, mozjpeg: true }).toBuffer();
    }

    console.log(`[cover] Optimized: ${Math.round(data.length / 1024)}KB -> ${Math.round(result.length / 1024)}KB`);

    return {
      data: new Uint8Array(result),
      mimeType: "image/jpeg",
    };
  } catch (err) {
    console.error("[cover] Failed to optimize image:", err);
    // Return original if optimization fails
    return { data, mimeType };
  }
}

export async function extractCoverArt(filePath: string): Promise<CoverArt | null> {
  try {
    if (!existsSync(filePath)) {
      return null;
    }

    const metadata = await mm.parseFile(filePath);
    const picture = metadata.common.picture?.[0];

    if (!picture) {
      return null;
    }

    const rawData = new Uint8Array(picture.data);
    
    // Optimize large images
    const { data, mimeType } = await optimizeImage(rawData, picture.format);

    return {
      data,
      mimeType,
      hash: hashBuffer(data),
    };
  } catch {
    return null;
  }
}

export function getExtension(mimeType: string): string {
  return mimeType.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
}

export function getCoverFilename(cover: CoverArt): string {
  return `${cover.hash}.${getExtension(cover.mimeType)}`;
}

// Get the parent folder name from a file path
// e.g., "/Users/florian/Music/song.mp3" -> "Music"
export function getFolderName(filePath: string): string {
  return path.basename(path.dirname(filePath));
}

/**
 * Track metadata extracted from audio file
 */
export interface TrackMetadata {
  title: string;
  artist: string;
  album: string;
  filePath: string;
  hasCover: boolean;
}

/**
 * Extract metadata from an audio file
 */
export async function extractMetadata(filePath: string): Promise<TrackMetadata | null> {
  try {
    if (!existsSync(filePath)) {
      return null;
    }

    const metadata = await mm.parseFile(filePath);
    const { title, artist, album, picture } = metadata.common;

    return {
      title: title || path.basename(filePath, path.extname(filePath)),
      artist: artist || "Unknown Artist",
      album: album || "Unknown Album",
      filePath,
      hasCover: !!(picture && picture.length > 0),
    };
  } catch {
    return null;
  }
}

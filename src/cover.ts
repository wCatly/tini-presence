import * as mm from "music-metadata";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
type SharpModule = (input: Buffer) => import("sharp").Sharp;

type JimpModule = {
  read: (data: Buffer) => Promise<{
    getWidth: () => number;
    getHeight: () => number;
    scaleToFit: (w: number, h: number) => void;
    quality: (q: number) => void;
    getBufferAsync: (mime: string) => Promise<Buffer>;
  }>;
  MIME_JPEG: string;
};

let sharpModule: SharpModule | null | undefined;
let jimpModule: JimpModule | null | undefined;

async function loadSharp() {
  if (sharpModule !== undefined) {
    return sharpModule;
  }
  try {
    const mod = await import("sharp");
    sharpModule = mod.default ?? mod;
    return sharpModule;
  } catch (err) {
    sharpModule = null;
    console.warn("[cover] sharp not available, skipping optimization:", err);
    return null;
  }
}

async function loadJimp() {
  if (jimpModule !== undefined) {
    return jimpModule;
  }
  try {
    const mod = (await import("jimp")) as unknown as { default?: JimpModule } & JimpModule;
    jimpModule = (mod.default ?? mod) as JimpModule;
    return jimpModule;
  } catch (err) {
    jimpModule = null;
    console.warn("[cover] jimp not available, skipping optimization:", err);
    return null;
  }
}

export async function getImageOptimizerStatus() {
  const sharp = await loadSharp();
  const jimp = await loadJimp();
  return {
    sharp: !!sharp,
    jimp: !!jimp,
  };
}

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

    const sharp = await loadSharp();
    if (sharp) {
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
    }

    const Jimp = await loadJimp();
    if (!Jimp) {
      return { data, mimeType };
    }

    const image = await Jimp.read(Buffer.from(data));
    const width = image.getWidth();
    const height = image.getHeight();

    if (width > MAX_IMAGE_SIZE || height > MAX_IMAGE_SIZE) {
      image.scaleToFit(MAX_IMAGE_SIZE, MAX_IMAGE_SIZE);
    }

    let quality = 90;
    image.quality(quality);
    let result = await image.getBufferAsync(Jimp.MIME_JPEG);

    while (result.length > MAX_FILE_SIZE && quality > 50) {
      quality -= 10;
      image.quality(quality);
      result = await image.getBufferAsync(Jimp.MIME_JPEG);
    }

    console.log(`[cover] Optimized (jimp): ${Math.round(data.length / 1024)}KB -> ${Math.round(result.length / 1024)}KB`);

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

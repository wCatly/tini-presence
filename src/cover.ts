import * as mm from "music-metadata";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

export interface CoverArt {
  data: Uint8Array;
  mimeType: string;
  hash: string;
}

export function hashBuffer(buffer: Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 16);
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

    const data = new Uint8Array(picture.data);

    return {
      data,
      mimeType: picture.format,
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

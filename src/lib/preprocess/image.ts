import sharp from "sharp";

/** EXIF auto-orient, downscale to 2000 px long side, mild contrast normalise (TRD §7). Original is kept in `raw`. */
export async function prepareImage(buf: Buffer): Promise<{ png: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(buf)
    .rotate()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .normalise({ lower: 1, upper: 99 })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { png: data, width: info.width, height: info.height };
}

import "server-only";
import sharp from "sharp";
import { cleanEmail } from "@/lib/preprocess/email";
import { get, put, signedUrl } from "@/lib/storage";
import type { ResponseFile } from "@/types/db";
import type { Loc } from "@/lib/comparison";

// DESIGN §2.10 evidence block, TRD §12.2. One shape for the drawer and the review queue.
export type Evidence = {
  kind: "image" | "pdf" | "text";
  url?: string;        // image (crop or full photo) or PDF page (#page=N, rendered by the browser's PDF viewer)
  text?: string;       // row / paragraph / line context
  mark?: string;       // phrase to highlight inside text
  caption: string;
  open_url?: string;   // original file
};

const PAD = 0.04; // TRD §12.2: pad 4%

/** Build the evidence block for a location in a response file (or the email body when file is null). */
export async function buildEvidence(loc: Loc | null | undefined, file: ResponseFile | null, emailText: string | null, cacheKey: string): Promise<Evidence | null> {
  if (!loc) return null;
  const snippet = loc.snippet?.trim() || undefined;
  const name = file?.original_name ?? "email body";
  const open_url = file ? await signedUrl("raw", file.storage_path) : undefined;

  if (loc.type === "image" && file?.derived_image_paths?.length) {
    const src = file.derived_image_paths[0];
    const dir = src.replace(/\/[^/]+$/, "");
    const b = loc.bbox?.length === 4 ? loc.bbox : null;
    // Light JPEG (≤ 900 px): a crop around the bbox when the reader gave one, else the whole photo. Generated once, then reused.
    const path = b ? `${dir}/crops/${cacheKey}.jpg` : `${dir}/preview.jpg`;
    let url = await signedUrl("derived", path).catch(() => null);
    if (!url) {
      let img = sharp(await get("derived", src));
      if (b) {
        const { width = 0, height = 0 } = await img.metadata();
        const left = Math.max(0, Math.floor((b[0] - PAD) * width)), top = Math.max(0, Math.floor((b[1] - PAD) * height));
        const w = Math.min(width - left, Math.ceil((b[2] - b[0] + 2 * PAD) * width)), h = Math.min(height - top, Math.ceil((b[3] - b[1] + 2 * PAD) * height));
        if (w > 8 && h > 8) img = img.extract({ left, top, width: w, height: h });
      }
      await put("derived", path, await img.resize({ width: 900, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer(), "image/jpeg");
      url = await signedUrl("derived", path);
    }
    return { kind: "image", url, text: snippet, caption: `${name}${b ? " · crop around the read" : " · whole photo"}`, open_url };
  }

  if (loc.type === "pdf" && file) {
    return { kind: "pdf", url: `${open_url}#page=${loc.page ?? 1}&view=FitH`, text: snippet, mark: snippet, caption: `${name} · page ${loc.page ?? "?"}`, open_url };
  }

  // Spreadsheet rows, document paragraphs and email lines: find the snippet in the derived text and show it with its neighbours.
  const derived = file?.derived_text_path ? (await get("derived", file.derived_text_path)).toString("utf8") : emailText ? cleanEmail(emailText) : "";
  const lines = derived.split("\n");
  let at = -1;
  if (loc.type === "cell" && loc.ref) at = lines.findIndex((l) => l.includes(` ${loc.ref}=`) || l.includes(`] ${loc.ref}=`));
  if (at < 0 && snippet) { const probe = snippet.slice(0, 30); at = lines.findIndex((l) => l.includes(probe)); }
  if (at < 0 && loc.line) at = lines.findIndex((l) => l.startsWith(`[p ${loc.line}]`) || l.startsWith(`[l ${loc.line}]`));
  const context = at < 0 ? snippet
    : loc.type === "cell" ? lines[at]
    : file ? around(lines[at], snippet) // document paragraph: only the matched one, windowed
    : lines.slice(Math.max(0, at - 1), at + 2).filter((l) => l.replace(/^\[l \d+\]/, "").trim()).join("\n"); // email: ±1 non-empty line
  const cellMark = loc.type === "cell" && loc.ref && at >= 0 ? lines[at].match(new RegExp(`${loc.ref}=[^ ]+`))?.[0] : undefined;
  const where = loc.type === "cell" ? `${loc.sheet ? `${loc.sheet} · ` : ""}cell ${loc.ref ?? "?"}` : file ? `paragraph ${loc.line ?? "?"}` : `line ${loc.line ?? "?"}`;
  return { kind: "text", text: context, mark: cellMark ?? snippet, caption: `${name} · ${where}`, open_url };
}

/** Long paragraphs: ~180 characters either side of the snippet. */
function around(text: string, snippet?: string, pad = 180): string {
  if (text.length <= 2 * pad + 60 || !snippet) return text;
  const i = Math.max(0, text.indexOf(snippet.slice(0, 30)));
  const a = Math.max(0, i - pad), b = Math.min(text.length, i + snippet.length + pad);
  return `${a > 0 ? "…" : ""}${text.slice(a, b)}${b < text.length ? "…" : ""}`;
}

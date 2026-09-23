import { PDFDocument } from "pdf-lib";

export const PDF_INLINE_MAX_PAGES = 20; // TRD §7: ≤ 20 pages → send whole PDF

export async function pdfPageCount(buf: Buffer): Promise<number> {
  return (await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false })).getPageCount();
}

/** > 20 pages → 10-page PDFs, processed sequentially by extract (TRD §7). */
export async function splitPdf(buf: Buffer, pagesPerChunk = 10): Promise<Buffer[]> {
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const n = src.getPageCount();
  if (n <= PDF_INLINE_MAX_PAGES) return [buf];
  const chunks: Buffer[] = [];
  for (let start = 0; start < n; start += pagesPerChunk) {
    const out = await PDFDocument.create();
    const idx = Array.from({ length: Math.min(pagesPerChunk, n - start) }, (_, i) => start + i);
    (await out.copyPages(src, idx)).forEach((p) => out.addPage(p));
    chunks.push(Buffer.from(await out.save()));
  }
  return chunks;
}

import path from "node:path";

export const ext = (name: string) => path.extname(name).slice(1).toUpperCase() || "FILE";

const FORMAT: Record<string, string> = { XLSX: "Excel", XLS: "Excel", CSV: "CSV", PDF: "PDF", DOCX: "Word", JPG: "photo", JPEG: "photo", PNG: "image", TXT: "text", EML: "email" };

/** "Excel", "PDF", "photo", "email" — how the vendor sent the quote. */
export function formatLabel(files: { original_name: string; file_kind: string | null }[], hasEmail: boolean) {
  const quote = files.find((f) => f.file_kind === "quotation") ?? files[0];
  return quote ? FORMAT[ext(quote.original_name)] ?? ext(quote.original_name) : hasEmail ? "email" : "—";
}

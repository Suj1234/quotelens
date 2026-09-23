import path from "node:path";
import { simpleParser } from "mailparser";
import { docxToText } from "./docx";
import { cleanEmail } from "./email";
import { prepareImage } from "./image";
import { pdfPageCount } from "./pdf";
import { xlsxToText } from "./xlsx";

export type Prepared =
  | { mode: "text"; text: string; note?: string }
  | { mode: "pdf"; pageCount: number }
  | { mode: "image"; png: Buffer; width: number; height: number }
  | { mode: "unsupported"; note: string };

const MIME: Record<string, string> = {
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xls": "application/vnd.ms-excel",
  ".csv": "text/csv", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".heic": "image/heic", ".txt": "text/plain", ".eml": "message/rfc822",
};

/** Browsers often send application/octet-stream; trust the extension first. */
export const mimeFor = (name: string, given?: string) =>
  MIME[path.extname(name).toLowerCase()] ?? (given && given !== "application/octet-stream" ? given : "application/octet-stream");

/** TRD §7: turn one received file into what the model will see. */
export async function preprocess(name: string, buf: Buffer): Promise<Prepared> {
  const ext = path.extname(name).toLowerCase();
  if (ext === ".xlsx" || ext === ".xls") return { mode: "text", ...noteTrunc(xlsxToText(buf)) };
  if (ext === ".csv") return { mode: "text", ...noteTrunc(xlsxToText(buf.toString("utf8"), { csv: true })) };
  if (ext === ".docx") return { mode: "text", text: await docxToText(buf) };
  if (ext === ".pdf") return { mode: "pdf", pageCount: await pdfPageCount(buf) };
  if ([".jpg", ".jpeg", ".png", ".webp", ".heic"].includes(ext)) return { mode: "image", ...(await prepareImage(buf)) };
  if (ext === ".txt") return { mode: "text", text: cleanEmail(buf.toString("utf8")) };
  if (ext === ".eml") {
    const mail = await simpleParser(buf);
    // ponytail: attachments inside a dropped .eml are not unpacked; Gmail sync (P6) handles MIME attachments.
    const head = [`From: ${mail.from?.text ?? ""}`, `Subject: ${mail.subject ?? ""}`, `Date: ${mail.date?.toISOString() ?? ""}`].join("\n");
    return { mode: "text", text: `${head}\n${cleanEmail(mail.text ?? "")}` };
  }
  return { mode: "unsupported", note: `unsupported type ${ext || "(no extension)"}` };
}

function noteTrunc(r: { text: string; truncated: string[] }) {
  return { text: r.text, note: r.truncated.length ? `truncated sheets: ${r.truncated.join(", ")}` : undefined };
}

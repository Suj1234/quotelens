// Review card wording shared by the queue (client) and its test. No server imports.

/** "Kohinoor Corrugators Pvt Ltd" → "Kohinoor Corrugators" (for button labels). */
export const short = (name?: string | null) => name?.replace(/\s+(pvt\.?\s*)?(ltd|limited)\.?$/i, "") ?? "the vendor";

/** "[l 8] text" / "[row 18] A18=4 B18=Box H18=13,710/-" → "text" / "4 · Box · 13,710/-" (the preprocessors' markers, DESIGN §2.10). */
export function plain(t: string): string {
  return t.split("\n").map((l) => l.replace(/^\[(?:l|p|row|table)\b[^\]]*\]\s*/, "").replace(/^[A-Z]{1,3}\d+=/, "").replace(/\s+[A-Z]{1,3}\d+=/g, " · ")).join("\n").trim();
}

/** "email body · line 8" → "From the email, line 8"; "Terms read from X.pdf" → "From X.pdf". The card already names the vendor. */
export function sourceLabel(caption: string): string {
  if (caption.startsWith("Settings")) return caption;
  if (caption.startsWith("Terms read from ")) { const f = caption.slice(16); return `From ${f === "the email body" ? "the email" : f}`; }
  if (caption.startsWith("Questionnaire answer")) { const f = caption.split(" · ")[1]; return `From the questionnaire answer${f ? ` in ${f === "email body" ? "the email" : f}` : ""}`; }
  const [src, ...rest] = caption.split(" · ");
  return `From ${src === "email body" ? "the email" : src}${rest.length ? `, ${rest.join(", ")}` : ""}`;
}

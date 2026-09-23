import mammoth from "mammoth";

const decode = (s: string) =>
  s.replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ").trim();

/** mammoth HTML → "[p N] text" paragraphs and "[table t row r] a | b | c" rows (TRD §7). */
export async function docxToText(buf: Buffer): Promise<string> {
  const { value: html } = await mammoth.convertToHtml({ buffer: buf });
  const out: string[] = [];
  let p = 0, t = 0;
  // Top-level blocks in document order. mammoth emits flat HTML; nested tables are rare in quotes.
  // ponytail: regex over mammoth's flat HTML; switch to a real HTML parser if nested tables show up.
  for (const m of html.matchAll(/<table>([\s\S]*?)<\/table>|<(p|h[1-6]|li)>([\s\S]*?)<\/\2>/g)) {
    if (m[1] !== undefined) {
      t++;
      let r = 0;
      for (const row of m[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
        const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => decode(c[1]));
        if (cells.some(Boolean)) out.push(`[table ${t} row ${++r}] ${cells.join(" | ")}`);
      }
    } else {
      const text = decode(m[3]);
      if (text) out.push(`[p ${++p}] ${text}`);
    }
  }
  return out.join("\n");
}

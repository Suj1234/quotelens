import * as XLSX from "xlsx";

const MAX_CELLS_PER_SHEET = 2000; // TRD §7

export type SheetText = { text: string; sheets: number; truncated: string[] };

/**
 * All sheets → "[row N] A1=… B1=…" lines with cell refs preserved (TRD §7).
 * Text cells verbatim ("84,080/-", "41810 (revised)"), numbers raw, dates as displayed,
 * hidden rows kept but marked "(hidden)", cell comments appended as "[comment: …]".
 */
export function xlsxToText(buf: Buffer | string, opts: { csv?: boolean } = {}): SheetText {
  const wb = typeof buf === "string" || opts.csv
    ? XLSX.read(buf.toString(), { type: "string", raw: true })
    : XLSX.read(buf, { type: "buffer", cellStyles: true, cellDates: true });
  const out: string[] = [];
  const truncated: string[] = [];
  let sheets = 0;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws["!ref"]) continue;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const hidden = new Set((ws["!rows"] ?? []).flatMap((r, i) => (r?.hidden ? [i] : [])));
    const lines: string[] = [];
    let cells = 0;
    rows: for (let r = range.s.r; r <= range.e.r; r++) {
      const parts: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const ref = XLSX.utils.encode_cell({ r, c });
        const cell = ws[ref] as XLSX.CellObject | undefined;
        if (!cell || cell.v === undefined || cell.v === null || String(cell.v).trim() === "") continue;
        if (++cells > MAX_CELLS_PER_SHEET) { truncated.push(name); break rows; }
        const v = cell.t === "d" ? (cell.w ?? String(cell.v)) : String(cell.v);
        let s = `${ref}=${v.replace(/\s*\n\s*/g, " / ")}`;
        const comments = (cell.c ?? []).map((x) => x.t?.trim()).filter(Boolean);
        if (comments.length) s += ` [comment: ${comments.join(" | ")}]`;
        parts.push(s);
      }
      if (parts.length) lines.push(`[row ${r + 1}]${hidden.has(r) ? " (hidden)" : ""} ${parts.join(" ")}`);
    }
    if (!lines.length) continue; // drop empty sheets
    sheets++;
    out.push(`=== sheet "${name}" ===`, ...lines);
    if (truncated.includes(name)) out.push(`[truncated after ${MAX_CELLS_PER_SHEET} cells]`);
  }
  if (truncated.length) console.warn(`[stage:preprocess] xlsx truncated sheets: ${truncated.join(", ")}`);
  return { text: out.join("\n"), sheets, truncated };
}

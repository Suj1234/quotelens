import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getResponseDetail, getRfx, type ItemRow } from "@/lib/rfx-detail";
import { countWord, longDate, money } from "@/lib/format";
import { ext, formatLabel } from "@/lib/file-labels";
import { currencyCode } from "@/lib/normalise/fx";
import { PipelineStrip } from "@/components/rfx/pipeline-strip";
import { Button } from "@/components/ui/button";
import type { MapSummary } from "@/lib/pipeline/map";
import type { Stage } from "@/types/db";

// TRD §17.7 / DESIGN §3.5 expanded row
export default async function ResponseDetailPage({ params, searchParams }: PageProps<"/rfx/[id]/responses/[rid]">) {
  const autoRun = (await searchParams).run === "1"; // arriving from "Submit and run" / the portal: start the six stages
  const user = await requireUser();
  const { id, rid } = await params;
  const [rfx, { response, vendor, files, items, terms, cells, openReviews }] = await Promise.all([getRfx(id), getResponseDetail(rid)]);
  const kindOf = (fileId: string | null) => files.find((f) => f.id === fileId);
  const priced = items.filter((i) => i.unit_price !== null).length;
  const timings = (response.summary.timings ?? {}) as Partial<Record<Stage, number>>;
  const mapping = (response.summary.map as MapSummary | undefined)?.mapping;
  const mappedTo = (itemId: string) => mapping?.filter((m) => m.item_id === itemId).map((m) => m.line_no).sort((a, b) => a - b) ?? [];
  const stateOf = (itemId: string) => cells.find((c) => c.extracted_item_id === itemId)?.state;
  const flags = ((response.summary.flags as { flags?: string[] } | undefined)?.flags ?? []);
  const t = terms as Record<string, string | number | boolean | null> | null;

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <Link href={`/rfx/${id}/responses`} className="hint" style={{ textDecoration: "none" }}>← All responses</Link>
          <h2 style={{ fontSize: 18, marginTop: 6 }}>{vendor?.name ?? "Unmatched sender"}</h2>
          <p className="text-muted-foreground" style={{ fontSize: 12, marginTop: 2 }}>
            {vendor?.city ? `${vendor.city} · ` : ""}{formatLabel(files, !!response.email_text)} · received {longDate(response.received_at)} · {response.source.replace("_", " ")}
          </p>
        </div>
      </div>
      <p className="lead" style={{ marginTop: 14 }}>
        {items.length
          ? <><b>{countWord(items.length)} items</b> read{priced < items.length ? `, ${priced} with a price` : ""} — shown exactly as the vendor wrote them, before any unit or currency conversion.</>
          : "Nothing read yet. Run the stages to classify the files and extract the prices."}
      </p>

      <div style={{ marginTop: 18 }}>
        <PipelineStrip responseId={rid} status={response.pipeline_status} errors={response.stage_errors} timings={timings} canRun={user.role !== "approver"} autoRun={autoRun && user.role !== "approver"} />
      </div>

      {/* TRD §17.7: flags chips, summary counts, Go to Review Queue (n) */}
      {(flags.length > 0 || mapping || openReviews > 0) && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
          {flags.map((f) => <span key={f} className="chip amber">{FLAG_LABEL[f] ?? f.replaceAll("_", " ")}</span>)}
          {mapping && <span className="hint">{countWord(new Set(mapping.map((m) => m.line_no)).size)} lines mapped · {cells.filter((c) => ["confirmed", "inferred", "reviewed"].includes(c.state)).length} priced in the grid</span>}
          <span style={{ flex: 1 }} />
          {openReviews > 0 && user.role !== "approver" && <Button asChild size="sm"><Link href={`/rfx/${id}/review?vendor=${vendor?.short_code ?? ""}`}>Go to Review Queue ({openReviews})</Link></Button>}
        </div>
      )}

      <div className="grid2" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="hd"><b>Files</b></div>
          <div className="bd" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {files.map((f) => (
              <div className="filerow" key={f.id} title={f.classify_reason ?? undefined}>
                <span className="ext">{ext(f.original_name)}</span>
                <a href={f.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{f.original_name}</a>
                <span style={{ flex: 1 }} />
                {f.file_kind
                  ? <span className={`chip ${f.file_kind === "quotation" ? "teal" : f.file_kind === "unknown" ? "amber" : "grey"}`}>
                      {f.file_kind.replace("_", " ")}{f.file_kind_probability != null && <> · <span className="mono">{f.file_kind_probability.toFixed(2)}</span></>}
                    </span>
                  : <span className="hint">not classified</span>}
              </div>
            ))}
            {response.email_text && (
              <div className="filerow">
                <span className="ext">TXT</span><span>(email body)</span><span style={{ flex: 1 }} />
                <EmailKind summary={response.summary} />
              </div>
            )}
            {!files.length && !response.email_text && <p className="hint">No files.</p>}
          </div>
        </div>

        <div className="card">
          <div className="hd"><b>Terms read</b></div>
          <div className="bd">
            {t ? (
              <dl className="kv">
                <dt>Currency</dt><dd>{(t.currency as string) ?? "not stated"}</dd>
                <dt>Validity</dt>
                <dd>
                  {t.validity_days ? `${t.validity_days} days` : t.validity_until ? `until ${longDate(t.validity_until as string)}` : "not stated"}
                  {typeof t.validity_days === "number" && t.validity_days < rfx.validity_days_requested && <> <span className="chip amber">shorter than asked</span></>}
                </dd>
                <dt>Freight</dt><dd>{[t.freight_terms_raw, t.freight_included === true ? "included" : t.freight_included === false ? "excluded" : null].filter(Boolean).join(" — ") || "not stated"}</dd>
                <dt>Payment</dt><dd>{(t.payment_terms_raw as string) ?? (t.payment_days ? `${t.payment_days} days` : "not stated")}</dd>
                {t.tax_terms_raw && <><dt>Taxes</dt><dd>{t.tax_terms_raw as string}</dd></>}
                {(t.total_discount_pct || t.total_discount_condition) && <><dt>Discount</dt><dd>{t.total_discount_pct ? `${t.total_discount_pct}% ` : ""}{t.total_discount_condition as string}</dd></>}
                {t.references_prior_pricing && <><dt>Prior pricing</dt><dd>“{(t.references_prior_pricing_text as string) ?? "refers to an earlier price"}”</dd></>}
                {t.other_notes && <><dt>Notes</dt><dd>{t.other_notes as string}</dd></>}
              </dl>
            ) : <p className="hint">Terms appear after extraction.</p>}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="hd"><b>Extracted items <span className="mono text-muted-foreground">{items.length}</span></b><span className="hint">as the vendor wrote it</span></div>
        {items.length ? (
          <div style={{ overflow: "auto", maxHeight: 520 }}>
            <table className="t">
              <thead>
                <tr><th>#</th><th>Vendor description</th><th className="num">Price as written</th><th>Unit as written</th><th>Pack</th><th>Where</th><th>Read</th>{mapping && <th>Mapped</th>}</tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} title={i.location.snippet}>
                    <td className="mono text-muted-foreground">{i.item_index}</td>
                    <td>
                      {i.vendor_sku && <span className="mono text-muted-foreground" style={{ marginRight: 6 }}>{i.vendor_sku}</span>}
                      {i.vendor_description}
                      {i.notes && <div className="hint" style={{ marginTop: 2 }}>{i.notes}</div>}
                    </td>
                    <td className="num mono">{i.unit_price === null ? "—" : money(i.unit_price, currencyCode(i.currency_raw))}</td>
                    <td className="text-muted-foreground">{i.price_unit_raw ?? "—"}</td>
                    <td className="mono">{i.pack_size ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="mono text-muted-foreground" style={{ fontSize: 11 }}>{where(i, kindOf(i.file_id)?.original_name)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <span className="pbar"><i style={{ width: `${Math.round((i.raw_confidence ?? 0) * 100)}%` }} /></span>{" "}
                      <span className="mono" style={{ fontSize: 11 }}>{i.raw_confidence?.toFixed(2) ?? "—"}</span>
                      {!mapping && (i.raw_confidence ?? 1) < 0.6 && <> <span className="chip amber">low read</span></>}
                    </td>
                    {mapping && <td className="mono" style={{ fontSize: 11, whiteSpace: "nowrap" }}><Mapped lines={mappedTo(i.id)} state={stateOf(i.id)} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="bd"><div className="empty">Items appear when extraction finishes.</div></div>}
      </div>
    </div>
  );
}

const FLAG_LABEL: Record<string, string> = {
  references_prior_pricing: "prior pricing", freight_excluded: "freight extra", validity_short: "short validity",
  currency_not_inr: "not INR", total_discount_present: "discount offered", partial_quote: "partial quote",
};

// DESIGN §3.5: mono "L14" + amber/grey chips for unit? / low read / prior.
function Mapped({ lines, state }: { lines: number[]; state?: string }) {
  if (!lines.length) return <span className="chip amber">unplaced</span>;
  const label = lines.length > 1 ? `L${lines[0]}–${lines[lines.length - 1]}` : `L${lines[0]}`;
  const chip = { ambiguous: ["amber", "unit?"], low_confidence: ["amber", "low read"], references_prior: ["grey", "prior"], conflict: ["amber", "conflict"], not_quoted: ["grey", "not quoted"] }[state ?? ""];
  return <>{label}{chip && <> <span className={`chip ${chip[0]}`}>{chip[1]}</span></>}</>;
}

function EmailKind({ summary }: { summary: Record<string, unknown> }) {
  const e = (summary.classify as { email?: { kind: string; p: number } } | undefined)?.email;
  if (!e) return <span className="hint">not classified</span>;
  return <span className={`chip ${e.kind === "quotation" ? "teal" : "grey"}`}>{e.kind.replace("_", " ")} · <span className="mono">{e.p.toFixed(2)}</span></span>;
}

/** Location in one line: "Price Offer!G8", "p.1", "photo", "para 5", "line 5". */
function where(i: ItemRow, fileName?: string) {
  const l = i.location;
  if (l.type === "cell") return `${l.sheet ? `${l.sheet}!` : ""}${l.ref ?? ""}`;
  if (l.type === "pdf") return `p.${l.page ?? "?"}`;
  if (l.type === "image") return "photo";
  const isDoc = fileName && /\.docx$/i.test(fileName);
  return `${isDoc ? "para" : "line"} ${l.line ?? "?"}`;
}

import "server-only";
import { db } from "@/lib/db";
import { signedUrl } from "@/lib/storage";

// TRD §17.9 / DESIGN §3.7 — Questionnaire, Documents, Ledger, Timeline tabs of the Comparison screen.

export type QaGrid = {
  vendors: { code: string; name: string }[];
  rows: { q_no: number; text: string; disqualifying: boolean; answers: Record<string, { show: string; tone: "" | "red" | "amber"; tip: string } | null> }[];
};

export async function getQuestionnaireGrid(rfxId: string): Promise<QaGrid> {
  const [qQ, aQ, vQ] = await Promise.all([
    db().from("rfx_questions").select("id, q_no, text, answer_type, disqualify_if").eq("rfx_id", rfxId).order("q_no"),
    db().from("questionnaire_answers").select("question_id, vendor_id, state, answer_bool, answer_number, answer_text, answer_raw, probability, provider, passes").eq("rfx_id", rfxId),
    db().from("rfx_vendors").select("vendors(id, short_code, name)").eq("rfx_id", rfxId),
  ]);
  for (const x of [qQ, aQ, vQ]) if (x.error) throw x.error;
  const vendors = (vQ.data ?? []).map((r) => r.vendors as unknown as { id: string; short_code: string; name: string }).sort((a, b) => a.name.localeCompare(b.name));
  return {
    vendors: vendors.map((v) => ({ code: v.short_code, name: v.name })),
    rows: (qQ.data ?? []).map((q) => ({
      q_no: q.q_no, text: q.text, disqualifying: !!q.disqualify_if,
      answers: Object.fromEntries(vendors.map((v) => {
        const a = (aQ.data ?? []).find((x) => x.question_id === q.id && x.vendor_id === v.id);
        if (!a) return [v.short_code, null];
        const p = a.probability != null ? ` · p ${Number(a.probability).toFixed(2)} (${a.provider === "jev-openrouter" ? "measured" : "LLM-estimated"})` : "";
        const tip = `${a.answer_raw ?? "not answered"}${p}`;
        if (a.state === "missing") return [v.short_code, { show: "—", tone: "amber", tip }];
        if (a.state === "ambiguous") return [v.short_code, { show: clip(a.answer_raw ?? "unclear", 28), tone: "amber", tip }];
        const show = q.answer_type === "yes_no" ? (a.answer_bool ? "Yes" : "No") : q.answer_type === "number" ? Number(a.answer_number).toLocaleString("en-IN") : clip(a.answer_text ?? a.answer_raw ?? "", 34);
        return [v.short_code, { show, tone: a.passes === false || (q.answer_type === "yes_no" && a.answer_bool === false) ? "red" : "", tip }];
      })),
    })),
  };
}

export type DocRow = { vendor: string; file: string; kind: string; p: number | null; pages: string; used: string; url: string | null };

export async function getDocuments(rfxId: string): Promise<DocRow[]> {
  const { data, error } = await db().from("responses").select("id, email_text, summary, vendors(name), response_files(*), extracted_items(id)").eq("rfx_id", rfxId).order("received_at");
  if (error) throw error;
  const rows: DocRow[] = [];
  for (const r of data ?? []) {
    const vendor = (r.vendors as unknown as { name: string } | null)?.name ?? "Unmatched sender";
    const n = (r.extracted_items as unknown[]).length;
    const qs = (r.summary as { questionnaire?: { answered: number } }).questionnaire?.answered;
    for (const f of r.response_files as { original_name: string; file_kind: string | null; file_kind_probability: number | null; page_count: number | null; derived_image_paths: string[] | null; storage_path: string; mime: string }[]) {
      const used = f.file_kind === "quotation" ? `${n} items, terms${qs ? ", questionnaire" : ""}` : f.file_kind === "questionnaire" ? `${qs ?? 0} answers` : f.file_kind === "supporting" ? "on file" : "—";
      rows.push({ vendor, file: f.original_name, kind: f.file_kind ?? "unknown", p: f.file_kind_probability, pages: f.page_count ? String(f.page_count) : f.derived_image_paths?.length ? "photo" : f.mime.includes("sheet") ? "sheet" : "—", used, url: await signedUrl("raw", f.storage_path) });
    }
    if (r.email_text) rows.push({ vendor, file: "(email body)", kind: (r.summary as { classify?: { email?: { kind: string } } }).classify?.email?.kind ?? "email", p: null, pages: "—", used: n && !(r.response_files as unknown[]).length ? `${n} items, terms` : "cover note", url: null });
  }
  return rows;
}

export type LedgerRow = { kind: string; vendor: string; lines: string; description: string; basis: string; by: string; at: string };

/** Active assumptions; per-line rows of one kind for one vendor are folded into one row ("1–22"). */
export async function getLedger(rfxId: string): Promise<LedgerRow[]> {
  const [aQ, uQ] = await Promise.all([
    db().from("assumptions").select("kind, description, basis, made_by, created_at, vendors(name), rfx_lines(line_no)").eq("rfx_id", rfxId).is("superseded_by", null).order("created_at"),
    db().from("users").select("id, name"),
  ]);
  if (aQ.error) throw aQ.error;
  const who = (id: string) => (id === "system" ? "system" : (uQ.data ?? []).find((u) => u.id === id)?.name ?? "buyer");
  type Group = { rows: { description: string; line: number | null; at: string }[]; kind: string; vendor: string; basis: string; by: string };
  const groups = new Map<string, Group>();
  for (const a of aQ.data ?? []) {
    const vendor = (a.vendors as unknown as { name: string } | null)?.name ?? "—";
    const line = (a.rfx_lines as unknown as { line_no: number } | null)?.line_no ?? null;
    const key = line !== null && a.made_by === "system" ? `${a.kind}|${vendor}|${a.basis}` : `${a.kind}|${vendor}|${a.basis}|${a.description}`;
    const g: Group = groups.get(key) ?? { rows: [], kind: a.kind, vendor, basis: a.basis ?? "", by: who(a.made_by) };
    g.rows.push({ description: a.description, line, at: a.created_at });
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const lines = g.rows.map((r) => r.line).filter((l): l is number => l !== null).sort((a, b) => a - b);
    return {
      kind: g.kind, vendor: g.vendor, lines: spans(lines), basis: g.basis.replaceAll("_", " "), by: g.by, at: g.rows[g.rows.length - 1].at,
      description: g.rows.length > 1 ? `${FOLDED[g.kind] ?? g.rows[0].description.replace(/^Line \d+: /, "")} (${g.rows.length} lines)` : g.rows[0].description,
    };
  });
}

// Folded per-line rows describe the rule, not one line's numbers.
const FOLDED: Record<string, string> = {
  weight_per_piece: "Per-kg rate converted with our spec's weight per piece for each line, not the vendor's",
  pack_size: "Pack size taken from our line spec (vendor didn't state it)",
  unit_conversion: "Unit converted on a basis the vendor didn't state",
};
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

/** [1,2,3,5,7,8] → "1–3, 5, 7–8"; [] → "—" */
export function spans(ns: number[]): string {
  if (!ns.length) return "—";
  const out: string[] = [];
  for (let i = 0; i < ns.length; i++) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    out.push(i === j ? String(ns[i]) : `${ns[i]}–${ns[j]}`);
    i = j;
  }
  return out.join(", ");
}

const INFO = ["fx_assumption", "discount_treatment", "freight_treatment", "validity_short", "missing_line"];

export type TimelineRow = { at: string; dir: "←" | "→" | "·"; text: string };

/** Audit events in words, newest first. Pipeline runs fold into one row per response (plus any failed stage). */
export async function getTimeline(rfxId: string): Promise<TimelineRow[]> {
  const [eQ, rQ, iQ, uQ] = await Promise.all([
    db().from("audit_events").select("event, actor, entity_id, payload, created_at").eq("rfx_id", rfxId).order("created_at", { ascending: false }).limit(400),
    db().from("responses").select("id, vendors(name)").eq("rfx_id", rfxId),
    db().from("review_items").select("id, title").eq("rfx_id", rfxId),
    db().from("users").select("id, name"),
  ]);
  if (eQ.error) throw eQ.error;
  const vendorOf = (id: string | null) => ((rQ.data ?? []).find((r) => r.id === id)?.vendors as unknown as { name: string } | null)?.name ?? "a vendor";
  const who = (id: string) => (id === "system" ? "QuoteLens" : (uQ.data ?? []).find((u) => u.id === id)?.name ?? "Someone");
  const title = (id: string | null) => (iQ.data ?? []).find((i) => i.id === id)?.title ?? "an item";
  const VERB: Record<string, string> = { confirm: "confirmed", override: "overrode", exclude: "excluded", map: "mapped", ignore: "ignored", "ask-vendor": "asked the vendor about", "mark-not-quoted": "treated as not quoted", dismiss: "dismissed", "accept-yes": "accepted as Yes", "treat-no": "treated as No" };
  const rows: TimelineRow[] = [];
  for (const e of eQ.data ?? []) {
    const p = e.payload as Record<string, unknown>;
    if (e.event === "pipeline.stage") {
      if (!p.ok) rows.push({ at: e.created_at, dir: "·", text: `Stage ${p.stage} failed for ${vendorOf(e.entity_id)}: ${String(p.error ?? "").slice(0, 120)}` });
      else if (p.stage === "flags") rows.push({ at: e.created_at, dir: "·", text: `Processed ${vendorOf(e.entity_id)}'s reply — all six stages done` });
      continue;
    }
    if (e.event === "response.received") rows.push({ at: e.created_at, dir: "←", text: `Reply received from ${vendorOf(e.entity_id)} (${String(p.source ?? "").replaceAll("_", " ")})` });
    else if (e.event === "seed.responses_loaded") rows.push({ at: e.created_at, dir: "←", text: `${who(e.actor)} loaded the ${p.set} seeded responses (${p.responses})` });
    else if (e.event.startsWith("review.")) {
      const a = e.event.slice(7);
      if (a === "ask-vendor" && p.mode !== "mark_sent") continue; // drafts aren't events worth a row
      const verb = a === "confirm" && INFO.includes(String(p.type)) ? "acknowledged" : VERB[a] ?? a;
      rows.push({ at: e.created_at, dir: a === "ask-vendor" ? "→" : "·", text: `${who(e.actor)} ${verb} “${title(e.entity_id).replace(/^“|”$/g, "")}”${p.reason ? ` — ${p.reason}` : ""}` });
    } else rows.push({ at: e.created_at, dir: e.event.startsWith("dispatch") ? "→" : "·", text: `${who(e.actor)}: ${e.event.replaceAll(".", " ")}` });
  }
  return rows.slice(0, 150);
}

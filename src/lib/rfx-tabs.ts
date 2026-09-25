import "server-only";
import { db } from "@/lib/db";
import { signedUrl } from "@/lib/storage";
import { stepText, type Step } from "@/lib/comparison";
import { money } from "@/lib/format";
import { describeChange, templateChanges, type Settings, type TemplatePart } from "@/lib/settings-schema";

// TRD §17.9 / DESIGN §3.7 — Questionnaire, Documents, Ledger, Timeline tabs of the Comparison screen.

export type QaCell = { show: string; tone: "" | "red" | "amber"; tip: string; raw: string | null; snippet: string | null; where: string | null; p: string | null; state: string; passes: boolean | null };
export type QaGrid = {
  vendors: { code: string; name: string }[];
  rows: { q_no: number; text: string; disqualifying: boolean; answers: Record<string, QaCell | null> }[];
};

export async function getQuestionnaireGrid(rfxId: string): Promise<QaGrid> {
  const [qQ, aQ, vQ] = await Promise.all([
    db().from("rfx_questions").select("id, q_no, text, answer_type, disqualify_if").eq("rfx_id", rfxId).order("q_no"),
    db().from("questionnaire_answers").select("question_id, vendor_id, state, answer_bool, answer_number, answer_text, answer_raw, probability, provider, passes, location").eq("rfx_id", rfxId),
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
        const p = a.probability != null ? ` · ${q.answer_type === "yes_no" ? "p(yes)" : "p"} ${Number(a.probability).toFixed(2)} (${a.provider === "jev-openrouter" ? "measured" : "LLM-estimated"})` : "";
        const tip = `${a.answer_raw ?? "not answered"}${p}`;
        const loc = a.location as { snippet?: string; page?: number; line?: number; sheet?: string; ref?: string; type?: string } | null;
        const ev = { tip, raw: a.answer_raw, snippet: loc?.snippet ?? null, p: p ? p.slice(3) : null, state: a.state, passes: a.passes,
          where: loc ? [loc.sheet && `sheet ${loc.sheet}`, loc.ref && `cell ${loc.ref}`, loc.page && `page ${loc.page}`, loc.line && `line ${loc.line}`].filter(Boolean).join(" · ") || null : null };
        if (a.state === "missing") return [v.short_code, { ...ev, show: "—", tone: "amber" }];
        if (a.state === "ambiguous") return [v.short_code, { ...ev, show: clip(a.answer_raw ?? "unclear", 28), tone: "amber" }];
        const show = q.answer_type === "yes_no" ? (a.answer_bool ? "Yes" : "No") : q.answer_type === "number" ? Number(a.answer_number).toLocaleString("en-IN") : clip(a.answer_text ?? a.answer_raw ?? "", 34);
        return [v.short_code, { ...ev, show, tone: a.passes === false || (q.answer_type === "yes_no" && a.answer_bool === false) ? "red" : "" }];
      })),
    })),
  };
}

export type DocRow = { vendor: string; file: string; kind: string; p: number | null; pages: string; used: string; url: string | null; text: string | null; response_id: string; at: string; reply: string };

export async function getDocuments(rfxId: string): Promise<DocRow[]> {
  const { data, error } = await db().from("responses").select("id, email_text, summary, received_at, is_clarification, vendors(name), response_files(*), extracted_items(id)").eq("rfx_id", rfxId).order("received_at");
  if (error) throw error;
  const rows: DocRow[] = [];
  const seen = new Map<string, number>(); // replies so far per vendor (rows come oldest first)
  for (const r of data ?? []) {
    const vendor = (r.vendors as unknown as { name: string } | null)?.name ?? "Unmatched sender";
    const n = (r.extracted_items as unknown[]).length;
    const qs = (r.summary as { questionnaire?: { answered: number } }).questionnaire?.answered;
    const nth = (seen.get(vendor) ?? 0) + (r.is_clarification ? 0 : 1);
    seen.set(vendor, nth);
    const at = r.received_at as string, reply = r.is_clarification ? "clarification reply" : `reply ${nth}`;
    // the email is the message; its attachments came with it
    if (r.email_text) rows.push({ vendor, file: "(email body)", kind: (r.summary as { classify?: { email?: { kind: string } } }).classify?.email?.kind ?? "email", p: null, pages: "—", used: n && !(r.response_files as unknown[]).length ? `${n} items, terms` : "cover note", url: null, text: r.email_text, response_id: r.id, at, reply });
    for (const f of r.response_files as { original_name: string; file_kind: string | null; file_kind_probability: number | null; page_count: number | null; derived_image_paths: string[] | null; storage_path: string; mime: string }[]) {
      const used = f.file_kind === "quotation" ? `${n} items, terms${qs ? ", questionnaire" : ""}` : f.file_kind === "questionnaire" ? `${qs ?? 0} answers` : f.file_kind === "supporting" ? "on file" : "—";
      rows.push({ vendor, file: f.original_name, kind: f.file_kind ?? "unknown", p: f.file_kind_probability, pages: f.page_count ? String(f.page_count) : f.derived_image_paths?.length ? "photo" : f.mime.includes("sheet") ? "sheet" : "—", used, url: await signedUrl("raw", f.storage_path), text: null, response_id: r.id, at, reply });
    }
  }
  // One block per vendor, in the order the conversation happened; unmatched senders last. (Stable sort keeps time order.)
  const U = "Unmatched sender";
  return rows.sort((a, b) => (a.vendor === U ? 1 : 0) - (b.vendor === U ? 1 : 0) || a.vendor.localeCompare(b.vendor));
}

/** One line an assumption touched: the vendor's figure, what was done to it, and the price that came out. */
export type LedgerCalc = { line: number; written: string; did: string; result: string };
export type LedgerRow = { kind: string; vendor: string; lines: string; description: string; basis: string; by: string; at: string; grade: "A" | "B" | "C" | "D"; calcs: LedgerCalc[] };
/** P10 B5: how reliable the source of an entry is — A vendor-stated · B our spec or an official rate · C buyer-entered · D a default or the AI's inference. */
export const gradeOfBasis = (basis: string | null): LedgerRow["grade"] =>
  basis === "vendor_stated" ? "A" : basis === "rfx_spec" || basis === "settings_default" ? "B" : basis === "buyer_entered" ? "C" : "D";

/** Active assumptions; per-line rows of one kind for one vendor are folded into one row ("1–22"). */
export async function getLedger(rfxId: string): Promise<LedgerRow[]> {
  const [aQ, uQ, cQ] = await Promise.all([
    db().from("assumptions").select("id, kind, description, basis, made_by, created_at, vendors(name), rfx_lines(line_no)").eq("rfx_id", rfxId).is("superseded_by", null).order("created_at"),
    db().from("users").select("id, name"),
    db().from("line_quotes").select("original_value, original_unit, original_currency, unit_price_inr_per_1000, best_guess_value, conversion_chain, rfx_lines(line_no)").eq("rfx_id", rfxId),
  ]);
  if (aQ.error) throw aQ.error;
  if (cQ.error) throw cQ.error;
  // Every cell whose conversion chain used an assumption (per-line ones and vendor-wide ones like an FX rate or a gross-up).
  const calcsOf = new Map<string, LedgerCalc[]>();
  for (const c of cQ.data ?? []) {
    const line = (c.rfx_lines as unknown as { line_no: number } | null)?.line_no;
    if (line == null) continue;
    const out = c.unit_price_inr_per_1000 ?? c.best_guess_value;
    for (const s of (c.conversion_chain ?? []) as (Step & { assumption_id?: string })[]) {
      if (!s.assumption_id) continue;
      const list = calcsOf.get(s.assumption_id) ?? [];
      list.push({ line, did: stepText(s),
        written: c.original_value != null ? `${money(Number(c.original_value), c.original_currency?.match(/\$|usd/i) ? "USD" : "INR")} ${c.original_unit ?? ""}`.trimEnd() : "—",
        result: out == null ? "—" : `${money(Number(out))} per 1000${c.unit_price_inr_per_1000 == null ? " (best guess, not counted)" : ""}` });
      calcsOf.set(s.assumption_id, list);
    }
  }
  const who = (id: string) => (id === "system" ? "system" : (uQ.data ?? []).find((u) => u.id === id)?.name ?? "buyer");
  type Group = { rows: { description: string; line: number | null; at: string }[]; kind: string; vendor: string; basis: string; by: string; calcs: LedgerCalc[] };
  const groups = new Map<string, Group>();
  for (const a of aQ.data ?? []) {
    const vendor = (a.vendors as unknown as { name: string } | null)?.name ?? "—";
    const line = (a.rfx_lines as unknown as { line_no: number } | null)?.line_no ?? null;
    const key = line !== null && a.made_by === "system" ? `${a.kind}|${vendor}|${a.basis}` : `${a.kind}|${vendor}|${a.basis}|${a.description}`;
    const g: Group = groups.get(key) ?? { rows: [], kind: a.kind, vendor, basis: a.basis ?? "", by: who(a.made_by), calcs: [] };
    g.rows.push({ description: a.description, line, at: a.created_at });
    g.calcs.push(...(calcsOf.get(a.id) ?? []));
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => {
    const lines = g.rows.map((r) => r.line).filter((l): l is number => l !== null).sort((a, b) => a - b);
    return {
      kind: g.kind, vendor: g.vendor, lines: spans(lines.length ? lines : [...new Set(g.calcs.map((c) => c.line))].sort((a, b) => a - b)), basis: g.basis.replaceAll("_", " "), grade: gradeOfBasis(g.basis), by: g.by, at: g.rows[g.rows.length - 1].at,
      calcs: g.calcs.sort((a, b) => a.line - b.line),
      description: g.rows.length <= 1 ? g.rows[0].description : g.rows.every((r) => r.description.includes("clarification reply"))
        ? clarified(g.rows) : `${FOLDED[g.kind] ?? g.rows[0].description.replace(/^Line \d+: /, "")} (${g.rows.length} lines)`,
    };
  });
}

// Folded per-line rows describe the rule, not one line's numbers.
const FOLDED: Record<string, string> = {
  weight_per_piece: "Per-kg rate converted with our spec's weight per piece for each line, not the vendor's",
  pack_size: "Pack size not stated by the vendor; best guess or our line spec used",
  unit_conversion: "Unit converted on a basis the vendor didn't state",
};
/** Folded answers from a vendor's clarification reply, in line order (prototype: "Bundle sizes 25 / 20 / 50 / 40 from vendor clarification"). */
function clarified(rows: { description: string; line: number | null }[]): string {
  const sorted = [...rows].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  const packs = sorted.map((r) => r.description.match(/(bundle|box) of (\d+)/));
  if (packs.every(Boolean)) return `${packs[0]![1] === "box" ? "Box" : "Bundle"} sizes ${packs.map((p) => p![2]).join(" / ")} from the vendor's clarification reply (${rows.length} lines)`;
  return `Values from the vendor's clarification reply: ${sorted.map((r) => r.description.replace(/ from the vendor's clarification reply.*$/, "")).join("; ")}`;
}
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

const INFO = ["fx_assumption", "discount_treatment", "freight_treatment", "tax_basis", "validity_short", "missing_line"];

export type TimelineRow = { at: string; dir: "←" | "→" | "·"; text: string; rfx_id?: string | null; actor?: string; area?: SettingsArea };
/** Which Settings sub-tab a workspace change belongs to, so each sub-tab lists its own history. */
export type SettingsArea = "communication" | "decision" | "currency" | TemplatePart | "vendors";
const KEY_AREA: Record<string, SettingsArea> = { email_mode: "communication", vendor_addresses: "communication", decision_provider: "decision", thresholds: "decision", price_check: "decision", ask_limit: "decision", fx_rates: "currency" };
type AuditEvent = { event: string; actor: string; entity_id: string | null; payload: unknown; created_at: string; rfx_id: string | null };

/** Audit events in words, oldest first (latest 150). Pipeline runs fold into one row per response (plus any failed stage). */
export async function getTimeline(rfxId: string): Promise<TimelineRow[]> {
  const eQ = await db().from("audit_events").select("event, actor, entity_id, payload, created_at, rfx_id").eq("rfx_id", rfxId).order("created_at", { ascending: false }).limit(400);
  if (eQ.error) throw eQ.error;
  return (await eventRows(eQ.data ?? [], rfxId)).slice(0, 150).reverse(); // the latest 150, shown oldest first like the prototype
}

export type AuditFilter = { rfx?: string | null; who?: string | null };
/** Settings → Activity → Audit log: every event, newest first (latest 500). rfx "workspace" = settings, masters, vendors; who "people" / "system" / a user id. */
export async function getAuditLog(f: AuditFilter = {}): Promise<TimelineRow[]> {
  let q = db().from("audit_events").select("event, actor, entity_id, payload, created_at, rfx_id").order("created_at", { ascending: false }).limit(500);
  if (f.rfx === "workspace") q = q.is("rfx_id", null); else if (f.rfx) q = q.eq("rfx_id", f.rfx);
  if (f.who === "people") q = q.neq("actor", "system"); else if (f.who) q = q.eq("actor", f.who);
  const { data, error } = await q;
  if (error) throw error;
  return eventRows(data ?? [], f.rfx && f.rfx !== "workspace" ? f.rfx : null);
}

const lowerFirst = (t: string) => t[0].toLowerCase() + t.slice(1);
const VFIELD: Record<string, string> = { name: "name", email: "email", contact_name: "contact", city: "city", state: "state", country: "country", default_currency: "currency", notes: "notes" };

/** Events (newest first) → rows in words, newest first. rfxId scopes the lookups when the events are one RFx's. */
async function eventRows(events: AuditEvent[], rfxId: string | null): Promise<TimelineRow[]> {
  const resp = db().from("responses").select("id, is_clarification, summary, vendors(name)"), items = db().from("review_items").select("id, title");
  const [rQ, iQ, uQ, vQ] = await Promise.all([
    rfxId ? resp.eq("rfx_id", rfxId) : resp,
    rfxId ? items.eq("rfx_id", rfxId) : items,
    db().from("users").select("id, name"),
    events.some((e) => e.event === "settings.changed") ? db().from("vendors").select("id, name") : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const vendorOf = (id: string | null) => ((rQ.data ?? []).find((r) => r.id === id)?.vendors as unknown as { name: string } | null)?.name ?? "a vendor";
  const clar = (id: string | null) => (rQ.data ?? []).find((r) => r.id === id);
  const who = (id: string) => (id === "system" ? "QuoteLens" : (uQ.data ?? []).find((u) => u.id === id)?.name ?? "Someone");
  const title = (id: string | null) => (iQ.data ?? []).find((i) => i.id === id)?.title ?? "an item";
  const vendorName = (id: string) => (vQ.data ?? []).find((v) => v.id === id)?.name ?? "a removed vendor";
  const VERB: Record<string, string> = { confirm: "confirmed", override: "overrode", exclude: "excluded", map: "mapped", ignore: "ignored", "ask-vendor": "asked the vendor about", "mark-not-quoted": "treated as not quoted", dismiss: "dismissed", "accept-yes": "accepted as Yes", "treat-no": "treated as No", "enter-prices": "entered prices for", "set-freight": "changed the freight on" };
  const rows: TimelineRow[] = [];
  for (const e of events) {
    const p = e.payload as Record<string, unknown>;
    const push = (dir: TimelineRow["dir"], text: string, area?: SettingsArea) => rows.push({ at: e.created_at, dir, text, rfx_id: e.rfx_id, actor: e.actor, area });
    if (e.event === "pipeline.stage") {
      if (!p.ok) push("·", `Stage ${p.stage} failed for ${vendorOf(e.entity_id)}: ${String(p.error ?? "").slice(0, 120)}`);
      else if (p.stage === "flags") {
        const r = clar(e.entity_id);
        const n = ((r?.summary as { normalise?: { clarification?: { lines: number[] } } } | undefined)?.normalise?.clarification?.lines ?? []).length;
        push("·", r?.is_clarification ? `Processed ${vendorOf(e.entity_id)}'s clarification reply — ${n} ${n === 1 ? "cell" : "cells"} resolved` : `Processed ${vendorOf(e.entity_id)}'s reply — all six stages done`);
      }
      continue;
    }
    if (e.event === "response.received") push("←", `${p.clarification ? "Clarification reply" : "Reply"} received from ${(p.vendor as string | undefined) ?? vendorOf(e.entity_id)} (${p.source === "portal" && p.message_id ? "mailbox" : String(p.source ?? "").replaceAll("_", " ")})`);
    else if (e.event === "clarification.sent") push("→", `${who(e.actor)} sent ${p.vendor} a clarification (${p.items} ${p.items === 1 ? "point" : "points"}: ${((p.titles as string[] | undefined) ?? []).map((t) => t.split(":")[0]).join(", ")})`);
    else if (e.event === "email.synced") push("←", `${who(e.actor)} synced the inbox — ${p.new} new${p.skipped ? `, ${p.skipped} already received` : ""}${p.ignored ? `, ${p.ignored} ignored` : ""}`);
    // P7 (PRD #34): scenarios, overrides, the memo, send back and approval, in words.
    else if (e.event === "scenario.saved") push("·", `${who(e.actor)} saved scenario “${p.name}”${p.total_short ? ` (${p.total_short})` : ""}${p.from_query ? " from an answer" : ""}`);
    else if (e.event === "scenario.override") push("·", `${who(e.actor)} gave line ${p.line_no} of “${p.name}” to ${p.vendor} instead of ${p.from_vendor} — ${p.reason}`);
    else if (e.event === "scenario.override_reverted") push("·", `${who(e.actor)} reverted the override on line ${p.line_no} of “${p.name}” (back to ${p.vendor})`);
    else if (e.event === "scenario.refreshed") push("·", `${who(e.actor)} refreshed scenario “${p.name}” with the latest prices${Array.isArray(p.changed_lines) && p.changed_lines.length ? ` (${p.changed_lines.length} ${p.changed_lines.length === 1 ? "line" : "lines"} changed)` : ""}`);
    else if (e.event === "scenario.deleted") push("·", `${who(e.actor)} deleted scenario “${p.name}”`);
    else if (e.event === "scenario.renamed") push("·", `${who(e.actor)} renamed award option “${p.from}” to “${p.to}”`);
    else if (e.event === "scenario.edited") push("·", `${who(e.actor)} changed what award option “${p.name}” asks for: “${p.to}”`);
    else if (e.event === "award.memo") push("·", `${who(e.actor)} ${p.regenerated ? "drafted the award memo again" : "drafted the award memo"}${p.version ? ` (version ${p.version})` : ""} from “${p.scenario}”`);
    else if (e.event === "award.sent_back") push("·", `${who(e.actor)} sent the memo back: “${p.note}”`);
    else if (e.event === "award.approved") push("·", `${who(e.actor)} approved the award — RFx locked`);
    else if (e.event === "seed.responses_loaded") push("←", `${who(e.actor)} loaded the ${p.set} seeded responses (${p.responses})`);
    // Settings, masters and vendors belong to no RFx (DECISIONS 2026-09-25 "Settings in four tabs").
    else if (e.event === "settings.changed") {
      if (p.key === "category_templates") {
        const b = (p.before ?? {}) as Settings["category_templates"], a = (p.after ?? {}) as Settings["category_templates"];
        for (const c of Object.keys({ ...b, ...a }).filter((c) => JSON.stringify(b[c]) !== JSON.stringify(a[c]))) {
          const ch = templateChanges(b[c], a[c], vendorName);
          for (const part of [...new Set(ch.map((x) => x.part))]) // one row per Masters sub-tab the save touched
            push("·", `${who(e.actor)} changed the ${c} masters — ${ch.filter((x) => x.part === part).map((x) => x.text).join("; ")}`, part);
        }
      } else push("·", `${who(e.actor)} changed ${lowerFirst(describeChange(String(p.key), p.before, p.after))}`, KEY_AREA[String(p.key)]);
    } else if (e.event === "vendor.created") push("·", `${who(e.actor)} added vendor ${p.name} (${p.email})${p.via === "copilot" ? " through the co-pilot" : p.via === "unmatched reply" ? " from an unmatched reply" : p.via === "rfx" ? " on an RFx" : ""}`, "vendors");
    else if (e.event === "vendor.updated") push("·", `${who(e.actor)} changed vendor ${p.name} — ${((p.changes as { field: string; before: unknown; after: unknown }[] | undefined) ?? []).map((c) => `${VFIELD[c.field] ?? c.field} ${c.before ?? "—"} → ${c.after ?? "—"}`).join(", ")}`, "vendors");
    else if (e.event === "rfx.created") push("·", `${who(e.actor)} created the RFx`);
    else if (e.event === "rfx.edited") push("·", `${who(e.actor)} edited the draft${p.via === "copilot" ? " through the co-pilot" : ""} — ${((p.changed as string[] | undefined) ?? []).join(", ") || "no change"}`);
    else if (e.event === "rfx.frozen") push("→", `${who(e.actor)} issued the RFx — v${p.version} frozen (${p.lines} lines, ${p.questions} questions, ${p.vendors} vendors)`);
    else if (e.event === "dispatch.sent") push("→", `RFx email sent to ${p.vendor} (${p.to})`);
    else if (e.event === "dispatch.failed") push("→", `RFx email to ${p.vendor} failed: ${String(p.error ?? "").slice(0, 120)}`);
    else if (e.event === "dispatch.redrafted") push("·", `${who(e.actor)} redrafted the RFx email to ${p.vendor}`);
    else if (e.event === "ask.turn") continue; // P11 #6: the question-limit counter, not an event worth a row (ask.query is)
    else if (e.event === "ask.query") push("·", `${who(e.actor)} asked a question — ${p.ok ? `${p.rows} ${p.rows === 1 ? "row" : "rows"}` : "failed"}${p.best_guess ? ", with best guesses" : ""}`);
    else if (e.event === "response.assign_vendor") push("·", `${who(e.actor)} assigned an unmatched reply to ${p.new ? "a new vendor" : "a vendor"}`);
    else if (e.event.startsWith("review.")) {
      const a = e.event.slice(7);
      if (a === "ask-vendor" && p.mode !== "mark_sent") continue; // drafts aren't events worth a row
      const verb = a === "confirm" && INFO.includes(String(p.type)) ? "acknowledged" : VERB[a] ?? a;
      push(a === "ask-vendor" ? "→" : "·", `${who(e.actor)} ${verb} “${title(e.entity_id).replace(/^“|”$/g, "")}”${p.reason ? ` — ${p.reason}` : ""}`);
    } else push(e.event.startsWith("dispatch") ? "→" : "·", `${who(e.actor)}: ${e.event.replaceAll(".", " ")}`);
  }
  return rows;
}

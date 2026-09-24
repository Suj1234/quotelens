// TRD §15.1 reply tags: `rfx-<rfx code>-<vendor short code>`, clarifications `…-clar-<n>`.
// TRD's regex /rfx-([a-z0-9-]+)-([a-z0-9]+)(?:-clar-(\d+))?/ can't tell where a hyphenated RFx code ends and a
// vendor code with digits begins, so a tag is resolved against the tags we actually issued (longest match wins).

export type Tag = { reply_tag: string; clar_n: number | null };

export const formatTag = (rfxCode: string, vendorShortCode: string, clarN?: number | null) =>
  `rfx-${rfxCode.toLowerCase()}-${vendorShortCode.toLowerCase()}${clarN ? `-clar-${clarN}` : ""}`;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Finds one of `knownTags` in an address, a subject or free text; null when none is there. */
export function parseTag(text: string | null | undefined, knownTags: string[]): Tag | null {
  if (!text) return null;
  const t = text.toLowerCase();
  let best: Tag | null = null;
  for (const tag of knownTags) {
    // Bounded on both sides so "…-westline" never matches inside "…-westline2" and "-clar-n" is read, not skipped.
    const m = t.match(new RegExp(`(?<![a-z0-9-])${esc(tag.toLowerCase())}(?:-clar-(\\d+))?(?![a-z0-9]|-[a-z0-9])`));
    if (m && (!best || tag.length > best.reply_tag.length)) best = { reply_tag: tag, clar_n: m[1] ? Number(m[1]) : null };
  }
  return best;
}

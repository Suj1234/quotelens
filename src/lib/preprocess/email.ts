/**
 * Pasted/received email body → "[l N] text" lines (TRD §7), after dropping
 * quoted replies ("> …", "On … wrote:" tails) and signatures ("-- " line, "Sent from my …").
 * The quoted RFx must never reach the model (CLAUDE.md §9).
 */
export function cleanEmail(body: string): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^(-- ?|—)$/.test(t) || /^sent from my\b/i.test(t)) break; // signature marker: rest is signature/quote
    if (/^on\b.{0,200}\bwrote:\s*$/i.test(t.replace(/^>\s*/, ""))) break; // "On <date>, <name> wrote:"
    if (/^-{2,}\s*(original message|forwarded message)\s*-{2,}$/i.test(t)) break;
    if (t.startsWith(">")) continue;
    kept.push(line.trimEnd());
  }
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  return kept.map((l, i) => `[l ${i + 1}] ${l}`).join("\n");
}

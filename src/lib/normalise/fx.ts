/** Currency as written → ISO code, or null when it isn't recognisable. (Full FX handling: P2-T4, TRD §11.3.) */
export function currencyCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/\.$/, "");
  if (/^(₹|rs|inr|rupees?|indian rupees?|re)$/.test(s) || s.includes("₹") || /\binr\b/.test(s)) return "INR";
  if (/^(\$|usd|us\$|us dollars?|dollars?)$/.test(s) || /\busd\b/.test(s) || s.startsWith("us$")) return "USD";
  if (/^(€|eur|euros?)$/.test(s) || /\beur\b/.test(s)) return "EUR";
  if (/^[a-z]{3}$/.test(s)) return s.toUpperCase();
  return null;
}

export type FxRate = { rate: number; date: string; source: string };
/** TRD §11.3: settings.fx_rates lookup. INR is 1; a missing rate is null (cell → ambiguous, never a silent 1). */
export function fxRate(rates: Record<string, FxRate>, code: string): FxRate | null {
  if (code === "INR") return { rate: 1, date: "", source: "base" };
  return rates[code] ?? null;
}

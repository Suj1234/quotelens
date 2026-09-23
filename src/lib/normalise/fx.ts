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

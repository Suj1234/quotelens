// Applies supabase/migrations/*.sql in order, once each (tracked in public._migrations). Needs DATABASE_URL.
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { requireEnv } from "@/lib/errors";

const DIR = path.join(process.cwd(), "supabase/migrations");
// Parse by hand: the password may contain URL-reserved characters (/ ? # @ :) that break `new URL()`.
// Never log the URL or the error's `input` — it carries the password.
function connection(url: string) {
  const m = url.match(/^postgres(?:ql)?:\/\/([^:]+):(.*)@([^@:/]+)(?::(\d+))?\/([^?]+)/);
  if (!m) throw new Error("DATABASE_URL is not in the form postgresql://user:password@host:port/db");
  return { username: m[1], password: m[2], host: m[3], port: Number(m[4] ?? 5432), database: m[5] };
}
const sql = postgres({ ...connection(requireEnv("DATABASE_URL")), ssl: "require", max: 1, onnotice: () => {} });

try {
  await sql`create table if not exists public._migrations (name text primary key, applied_at timestamptz default now())`;
  await sql`alter table public._migrations enable row level security`;
  const done = new Set((await sql<{ name: string }[]>`select name from public._migrations`).map((r) => r.name));
  for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(f)) { console.log(`[migrate] skip ${f}`); continue; }
    await sql.begin(async (tx) => {
      await tx.unsafe(fs.readFileSync(path.join(DIR, f), "utf8"));
      await tx`insert into public._migrations (name) values (${f})`;
    });
    console.log(`[migrate] applied ${f}`);
  }
} catch (e) {
  console.error(`[migrate] failed: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}

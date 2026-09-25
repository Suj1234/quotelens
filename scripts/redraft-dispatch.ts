// Rewrite an issued RFx's mock-mode dispatch emails with the current P-DISPATCH (DECISIONS 2026-09-25).
// npx tsx --env-file-if-exists=.env.local --conditions=react-server scripts/redraft-dispatch.ts --rfx MER-0423
import { db } from "@/lib/db";
import { redraftDispatch } from "@/lib/dispatch";

const code = process.argv[process.argv.indexOf("--rfx") + 1];
if (!code || code === process.argv[1]) throw new Error("Usage: --rfx MER-0423");
const { data: rfx } = await db().from("rfx").select("id").eq("code", code).single();
if (!rfx) throw new Error(`${code} not found`);
// Redraft in the name of whoever sent the originals.
const { data: first } = await db().from("communications").select("from_addr").eq("rfx_id", rfx.id).eq("kind", "rfx_dispatch").limit(1).single();
const email = first?.from_addr.match(/<([^>]+)>/)?.[1] ?? first?.from_addr;
const { data: user } = await db().from("users").select("id, name, email, role").eq("email", email).single();
if (!user) throw new Error(`No user for ${email}`);
console.table(await redraftDispatch(rfx.id, user));

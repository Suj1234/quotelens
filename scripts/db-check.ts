// P0-T2 done-when: `select count(*) from rfx` runs, buckets exist, run_readonly_query is callable.
import { db } from "@/lib/db";

const rfx = await db().from("rfx").select("*", { count: "exact", head: true });
if (rfx.error) throw rfx.error;
console.log("rfx count:", rfx.count);

const buckets = await db().storage.listBuckets();
if (buckets.error) throw buckets.error;
console.log("buckets:", buckets.data.map((b) => `${b.id}${b.public ? " (PUBLIC!)" : ""}`).join(", "));

const q = await db().rpc("run_readonly_query", { q: "select count(*) as n from v_comparison" });
if (q.error) throw q.error;
console.log("run_readonly_query:", JSON.stringify(q.data));

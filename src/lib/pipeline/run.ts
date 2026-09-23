import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/log";
import { getResponse } from "@/lib/responses";
import { STAGES, type ResponseRow, type Stage } from "@/types/db";
import { classify } from "./classify";
import { extract } from "./extract";
import { map } from "./map";
import { normalise } from "./normalise";

type StageFn = (resp: ResponseRow) => Promise<Record<string, unknown>>;
// Stages land phase by phase (CLAUDE.md §3); the rest report "not built yet" instead of pretending.
const IMPL: Partial<Record<Stage, StageFn>> = { classify, extract, map, normalise };

export type StageEvent = { stage: Stage; status: "done" | "error" | "skipped"; ms: number; summary?: unknown; error?: string };

/** One stage for one response: inputs from the DB, outputs to the DB, status + audit event (TRD §8). */
export async function runStage(responseId: string, stage: Stage, actor = "system"): Promise<StageEvent> {
  if (!STAGES.includes(stage)) throw new AppError("BAD_STAGE", `Unknown stage ${stage}`, undefined, 400);
  const fn = IMPL[stage];
  if (!fn) return { stage, status: "skipped", ms: 0, error: "not built yet" };

  const resp = await getResponse(responseId);
  await setStatus(resp, stage, "running");
  const t0 = Date.now();
  console.log(`[stage:${stage}] start ${responseId}`);
  try {
    const summary = await fn(resp);
    const ms = Date.now() - t0;
    const fresh = await getResponse(responseId);
    await patch(responseId, {
      pipeline_status: { ...fresh.pipeline_status, [stage]: "done" },
      stage_errors: omit(fresh.stage_errors, stage),
      summary: { ...fresh.summary, [stage]: summary, timings: { ...(fresh.summary.timings as object), [stage]: ms } },
    });
    await audit({ rfx_id: resp.rfx_id, actor, event: "pipeline.stage", entity_type: "response", entity_id: responseId, payload: { stage, ok: true, ms, counts: summary } });
    console.log(`[stage:${stage}] done ${responseId} in ${ms} ms`);
    return { stage, status: "done", ms, summary };
  } catch (e) {
    const ms = Date.now() - t0;
    const message = (e as Error).message;
    const fresh = await getResponse(responseId);
    await patch(responseId, {
      pipeline_status: { ...fresh.pipeline_status, [stage]: "error" },
      stage_errors: { ...fresh.stage_errors, [stage]: message },
    });
    await audit({ rfx_id: resp.rfx_id, actor, event: "pipeline.stage", entity_type: "response", entity_id: responseId, payload: { stage, ok: false, ms, error: message } });
    console.error(`[stage:${stage}] error ${responseId}: ${message}`);
    return { stage, status: "error", ms, error: message };
  }
}

/** Server-side chain; stops at the first error (TRD §8). */
export async function* runAll(responseId: string, actor = "system", from: Stage = "classify"): AsyncGenerator<StageEvent> {
  for (const stage of STAGES.slice(STAGES.indexOf(from))) {
    const ev = await runStage(responseId, stage, actor);
    yield ev;
    if (ev.status === "error") return;
  }
}

async function setStatus(resp: ResponseRow, stage: Stage, state: "running") {
  await patch(resp.id, { pipeline_status: { ...resp.pipeline_status, [stage]: state } });
}
async function patch(id: string, fields: Partial<ResponseRow>) {
  const { error } = await db().from("responses").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}
const omit = <T extends object>(o: T, k: string) => Object.fromEntries(Object.entries(o).filter(([key]) => key !== k)) as T;

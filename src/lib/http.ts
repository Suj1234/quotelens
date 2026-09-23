import "server-only";
import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";

/** Wrap a route handler: AppError → {error, code} with its status; anything else → 500. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response | unknown>) {
  return async (...args: A): Promise<Response> => {
    try {
      const out = await fn(...args);
      return out instanceof Response ? out : NextResponse.json(out);
    } catch (e) {
      if (e instanceof AppError) {
        return NextResponse.json({ error: e.message, code: e.code, details: e.details }, { status: e.status });
      }
      console.error("[api]", e);
      return NextResponse.json({ error: "Something went wrong on our side.", code: "INTERNAL" }, { status: 500 });
    }
  };
}

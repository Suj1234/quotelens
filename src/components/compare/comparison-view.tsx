"use client";

import { useCallback, useState } from "react";
import type { Grid } from "@/lib/comparison";
import { ProvenanceDrawer } from "./drawer";
import { PricesGrid } from "./prices-grid";

/** Prices grid + provenance drawer (click a cell → drawer). */
export function ComparisonView({ rfxId, grid, canReview, approver, locked }: { rfxId: string; grid: Grid; canReview: boolean; approver: boolean; locked: boolean }) {
  const [sel, setSel] = useState<string | null>(null);
  const [basis, setBasis] = useState<"unit" | "landed">("unit");
  const close = useCallback(() => setSel(null), []);
  return (
    <>
      <PricesGrid rfxId={rfxId} grid={grid} approver={approver} selected={sel} onOpen={(l, v) => setSel(`${l}:${v}`)} onBasis={setBasis} />
      {sel && <ProvenanceDrawer key={sel} rfxId={rfxId} cellKey={sel} basis={basis} canReview={canReview} locked={locked} onClose={close} />}
    </>
  );
}

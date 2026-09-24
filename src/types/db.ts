// Row types mirroring TRD §6 (hand-written). Tables are added here as the phase that uses them lands.

export type Role = "buyer" | "approver" | "admin";

export interface User { id: string; email: string; name: string; role: Role; password_hash: string; created_at: string }

export interface Vendor {
  id: string; name: string; short_code: string; contact_name: string | null; email: string;
  city: string | null; state: string | null; country: string; default_currency: string; notes: string | null;
  created_by: "seed" | "user" | "auto"; created_at: string;
}

export type RfxStatus = "draft" | "issued" | "receiving" | "reviewing" | "awarded" | "closed";

export interface Rfx {
  id: string; code: string; title: string; category: string; status: RfxStatus; version: number;
  frozen_at: string | null; buyer_id: string | null; currency: string; quote_unit: string; incoterm: string;
  freight_included_requested: boolean; payment_terms_days: number; validity_days_requested: number;
  contract_months: number; response_deadline: string | null; delivery_locations: string[];
  cover_note: string | null; copilot_transcript: unknown[]; created_at: string; updated_at: string | null;
  terms_set: boolean; // migration 0008
}

export interface RfxLine {
  id: string; rfx_id: string; line_no: number; sku: string; description: string; ply: number | null;
  length_mm: number | null; width_mm: number | null; height_mm: number | null; gsm_spec: string | null;
  burst_factor: number | null; item_type: string | null; weight_per_piece_g: number | null;
  monthly_qty: number; annual_qty: number; delivery_location: string; spec_attributes: Record<string, unknown>;
}

export interface RfxQuestion {
  id: string; rfx_id: string; q_no: number; text: string; answer_type: "yes_no" | "number" | "text";
  mandatory: boolean; disqualify_if: string | null;
}

export type RfxVendorStatus = "invited" | "responded" | "clarification_sent" | "clarified" | "disqualified" | "excluded";

export interface RfxVendor {
  id: string; rfx_id: string; vendor_id: string; reply_tag: string; invited_at: string | null;
  status: RfxVendorStatus; disqualified_reason: string | null;
  freight_assumption_inr_per_1000: number | null; freight_basis: string | null;
}

export interface Setting { key: string; value: unknown; updated_at: string }

export const STAGES = ["classify", "extract", "map", "normalise", "questionnaire", "flags"] as const;
export type Stage = (typeof STAGES)[number];
export type StageState = "pending" | "running" | "done" | "error";
export type FileKind = "quotation" | "questionnaire" | "supporting" | "not_relevant" | "unknown";

export interface ResponseRow {
  id: string; rfx_id: string; vendor_id: string | null; source: string; communication_id: string | null;
  email_text: string | null; received_at: string; pipeline_status: Partial<Record<Stage, StageState>>;
  stage_errors: Partial<Record<Stage, string>>; summary: Record<string, unknown>;
  is_clarification: boolean; supersedes_response_id: string | null; created_at: string; updated_at: string | null;
}

export interface ResponseFile {
  id: string; response_id: string; original_name: string; mime: string; size_bytes: number; storage_path: string;
  derived_text_path: string | null; derived_image_paths: string[] | null; file_kind: FileKind | null;
  file_kind_probability: number | null; file_kind_provider: string | null; classify_reason: string | null;
  page_count: number | null; created_at: string;
}

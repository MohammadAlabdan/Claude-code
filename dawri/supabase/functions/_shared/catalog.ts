// Owner catalog editing. Writes go through the owner's own JWT so RLS decides what they may touch.
import type { SupabaseClient } from "@supabase/supabase-js";
import { rpc } from "./db.ts";
import { HttpError } from "./http.ts";

type Spec = { columns: string[]; feature?: (row: Record<string, unknown>) => string | null; key?: string; noDelete?: boolean; noInsert?: boolean };

export const CATALOG: Record<string, Spec> = {
  services: { columns: ["branch_id", "name", "mode", "avg_minutes", "is_active", "sort"] },
  providers: { columns: ["branch_id", "display_name", "service_ids", "is_active"], feature: () => null },
  menu_items: {
    columns: ["branch_id", "category", "name", "description", "price_sar", "duration_min", "is_available", "sort", "service_id"],
    feature: () => "menu",
  },
  offers: {
    columns: ["branch_id", "kind", "title", "terms", "discount_text", "weekdays", "start_time", "end_time", "valid_from", "valid_to", "max_redemptions", "is_active"],
    feature: (r) => (r.kind === "quiet_coupon" ? "quiet_coupon" : "timed_offers"),
  },
  news_posts: { columns: ["branch_id", "title", "body", "published_at"], feature: () => "news" },
  business_pages: { columns: ["branch_id", "bio", "photos", "highlights", "is_published"], feature: () => "full_page", key: "branch_id", noDelete: true },
  branches: { columns: ["name", "address", "map_url", "phone", "google_review_url", "hours"], noDelete: true, noInsert: true },
};

export function spec(table: unknown): Spec & { table: string } {
  if (typeof table !== "string" || !(table in CATALOG)) throw new HttpError("invalid_input", { field: "table" });
  return { ...CATALOG[table], table };
}

export function pick(row: unknown, columns: string[]): Record<string, unknown> {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new HttpError("invalid_input", { field: "row" });
  const out: Record<string, unknown> = {};
  for (const c of columns) if (c in (row as Record<string, unknown>)) out[c] = (row as Record<string, unknown>)[c];
  return out;
}

export async function checkFeature(s: Spec, branchId: string, row: Record<string, unknown>) {
  const feature = s.feature?.(row);
  if (!feature) return;
  if (!(await rpc<boolean>("has_feature", { p_branch: branchId, p_feature: feature }))) {
    const required = await rpc<string>("feature_min_plan", { p_feature: feature });
    throw new HttpError("feature_locked", { feature, required_plan: required });
  }
}

/** Maps Postgres errors from a user-client write to API errors. */
export function dbError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.code === "42501" || error.code === "PGRST116") throw new HttpError("forbidden");
  if (error.code?.startsWith("23") || error.code === "22P02" || error.code === "22007") {
    throw new HttpError("invalid_input", { detail: error.message });
  }
  console.error(error);
  throw new HttpError("server_error");
}

export async function listRows(db: SupabaseClient, table: string, branchId: string) {
  const order = table === "news_posts" ? "published_at" : table === "offers" || table === "providers" ? "created_at" : table === "branches" || table === "business_pages" ? null : "sort";
  let q = db.from(table).select("*").eq(table === "branches" ? "id" : "branch_id", branchId);
  if (order) q = q.order(order, { ascending: order !== "published_at" });
  const { data, error } = await q;
  dbError(error);
  return data;
}

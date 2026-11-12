import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http.ts";
import { PgClient } from "./pg.ts";

let admin: SupabaseClient | null = null;

/** "netlify": Netlify Functions + Netlify Database (plain Postgres) instead of Supabase. */
export const isNetlify = () => Deno.env.get("DAWRI_BACKEND") === "netlify";

export function env(name: string, fallback?: string): string {
  const v = Deno.env.get(name) ?? fallback;
  if (v === undefined) throw new Error(`Missing environment variable ${name}`);
  return v;
}

/** Service-role client. Bypasses RLS: only call vetted SQL functions with it. */
export function adminClient(): SupabaseClient {
  if (isNetlify()) return (admin ??= new PgClient() as unknown as SupabaseClient);
  admin ??= createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

/** Client acting as the signed-in owner, so RLS applies (used for catalog CRUD). */
export function userClient(jwt: string, userId?: string): SupabaseClient {
  if (isNetlify()) {
    if (!userId) throw new HttpError("unauthorized");
    return new PgClient(userId) as unknown as SupabaseClient;
  }
  return createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

export type Json = Record<string, unknown>;

/** Calls a SQL function and returns its jsonb result. Business errors come back as {error}. */
export async function rpc<T = Json>(fn: string, args: Json): Promise<T> {
  const { data, error } = await adminClient().rpc(fn, args);
  if (error) {
    console.error(`rpc ${fn} failed`, error);
    throw new HttpError("server_error");
  }
  return data as T;
}

/** Like rpc(), but turns an {error} result into an HttpError. */
export async function rpcOk<T extends Json = Json>(fn: string, args: Json): Promise<T> {
  const data = await rpc<T>(fn, args);
  if (data && typeof data === "object" && "error" in data) {
    const { error, ...extra } = data as Json;
    throw new HttpError(String(error), extra);
  }
  return data;
}

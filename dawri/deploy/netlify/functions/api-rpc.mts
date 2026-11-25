// Public calls the pages make directly (PostgREST rpc on Supabase): shop page, ticket, and the quote page.
import "../../lib/deno.mts";
import type { Config, Context } from "@netlify/functions";
import { PgClient } from "../../src/_shared/pg.ts";

const ALLOWED: Record<string, string[]> = {
  public_branch: ["p_public_id"], public_ticket: ["p_token"], public_quote: ["p_token"], quote_accept: ["p_token", "p_name"],
};

export default async (req: Request, context: Context) => {
  const fn = context.params.fn;
  const args = ALLOWED[fn];
  if (!args || req.method !== "POST") return Response.json({ error: "invalid_action" }, { status: 404 });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const a of args) {
    const v = typeof body[a] === "string" ? (body[a] as string).slice(0, 100) : null;
    if (!v) return Response.json({ error: "invalid_input" }, { status: 400 });
    values[a] = v;
  }
  const { data, error } = await new PgClient().rpc(fn, values);
  if (error) { console.error(fn, error); return Response.json({ error: "server_error" }, { status: 500 }); }
  return Response.json(data, { headers: { "cache-control": "no-store" } });
};

export const config: Config = { path: "/api/rpc/:fn" };

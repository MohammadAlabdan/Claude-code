// The two public reads the pages make directly (PostgREST rpc on Supabase): the shop page and a ticket.
import "../../lib/deno.mts";
import type { Config, Context } from "@netlify/functions";
import { PgClient } from "../../src/_shared/pg.ts";

const ALLOWED: Record<string, string> = { public_branch: "p_public_id", public_ticket: "p_token" };

export default async (req: Request, context: Context) => {
  const fn = context.params.fn;
  const arg = ALLOWED[fn];
  if (!arg || req.method !== "POST") return Response.json({ error: "invalid_action" }, { status: 404 });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const value = typeof body[arg] === "string" ? (body[arg] as string).slice(0, 100) : null;
  if (!value) return Response.json({ error: "invalid_input" }, { status: 400 });
  const { data, error } = await new PgClient().rpc(fn, { [arg]: value });
  if (error) { console.error(fn, error); return Response.json({ error: "server_error" }, { status: 500 }); }
  return Response.json(data, { headers: { "cache-control": "no-store" } });
};

export const config: Config = { path: "/api/rpc/:fn" };

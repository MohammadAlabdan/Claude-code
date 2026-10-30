// Local-only stand-in for Supabase's REST gateway, enough to run the Edge Functions against a plain Postgres:
//   POST /rest/v1/rpc/<fn>     → select public.<fn>(named args…)   (types read from pg_proc)
//   GET/DELETE /rest/v1/<tbl>  → []  (table reads used only for push delivery; no subscriptions locally)
//   POST /realtime/v1/api/broadcast → 202, logged
// Usage: deno run -A scripts/local-db/fake-rest.ts   (PG* env vars select the database)
import postgres from "npm:postgres@3.4.5";

const sql = postgres({ host: Deno.env.get("PGHOST"), port: Number(Deno.env.get("PGPORT") ?? 5432),
  user: Deno.env.get("PGUSER") ?? "postgres", database: Deno.env.get("DB") ?? "dawri_test" });
const broadcasts: unknown[] = [];

Deno.serve({ port: Number(Deno.env.get("FAKE_REST_PORT") ?? 9999) }, async (req) => {
  const url = new URL(req.url);
  const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/);
  if (rpc && req.method === "POST") {
    const args = await req.json() as Record<string, unknown>;
    const [proc] = await sql`select proargnames names, array(select format_type(t, null) from unnest(proargtypes) t) types from pg_proc
                             where proname = ${rpc[1]} and pronamespace = 'public'::regnamespace`;
    if (!proc) return Response.json({ message: `function ${rpc[1]} not found` }, { status: 404 });
    const names = Object.keys(args);
    for (const n of names) if (!proc.names.includes(n)) return Response.json({ message: `unknown arg ${n} for ${rpc[1]}` }, { status: 400 });
    const parts = names.map((n, i) => `${n} => $${i + 1}::${proc.types[proc.names.indexOf(n)]}`);
    const values = names.map((n) => { const v = args[n]; return v !== null && typeof v === "object" ? JSON.stringify(v) : v; });
    try {
      const [row] = await sql.unsafe(`select to_jsonb(public.${rpc[1]}(${parts.join(", ")})) r`, values as never[]);
      return Response.json(row.r);
    } catch (e) {
      return Response.json({ message: String(e) }, { status: 400 });
    }
  }
  if (url.pathname === "/realtime/v1/api/broadcast") {
    broadcasts.push(await req.json());
    return new Response(null, { status: 202 });
  }
  if (url.pathname === "/__broadcasts") return Response.json(broadcasts);
  if (url.pathname.startsWith("/rest/v1/")) return Response.json([]);
  return new Response("not found", { status: 404 });
});

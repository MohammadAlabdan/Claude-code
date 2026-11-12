// Netlify backend: a small stand-in for the parts of supabase-js the functions use, on plain Postgres (Netlify Database).
// Covers: rpc(fn, args), from(t).select/insert/update/upsert/delete with eq/in/order/single, one level of
// many-to-one embedding ("cols, parent(cols)"), and auth.getUser(jwt) with our own HS256 tokens.
// userClient() runs its statements as role "authenticated" with the caller's id, so the same RLS policies apply.
import { HttpError } from "./http.ts";

type Row = Record<string, unknown>;
type PgError = { code?: string; message?: string };
type Result<T> = { data: T | null; error: PgError | null };

// deno-lint-ignore no-explicit-any
let pool: any = null;
async function getPool() {
  if (pool) return pool;
  const url = Deno.env.get("NETLIFY_DB_URL") ?? Deno.env.get("DATABASE_URL");
  if (!url) throw new Error("NETLIFY_DB_URL is not set");
  const pg = (await import("pg")).default;
  pool = new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000 });
  return pool;
}

/** Runs statements on one connection, optionally as the signed-in owner (role authenticated + claim sub). */
async function run<T>(asUser: string | null, fn: (q: (sql: string, params?: unknown[]) => Promise<Row[]>) => Promise<T>): Promise<T> {
  const p = await getPool();
  const c = await p.connect();
  try {
    if (asUser) {
      await c.query("begin");
      await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)", [asUser]);
      await c.query("set local role authenticated");
    }
    const out = await fn(async (sql, params = []) => (await c.query(sql, params)).rows);
    if (asUser) await c.query("commit");
    return out;
  } catch (e) {
    if (asUser) await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new HttpError("invalid_input", { field: "column" });
  return `"${s}"`;
};
const singular = (t: string) => (/(s|sh|ch|x)es$/.test(t) ? t.slice(0, -2) : t.slice(0, -1));

/** "id, name, businesses(name, category)" → SQL select list. */
function selectList(table: string, cols: string): string {
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of cols) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.map((p) => {
    if (p === "*") return `${ident(table)}.*`;
    const m = p.match(/^([a-z_]+)\((.+)\)$/);
    if (!m) return `${ident(table)}.${ident(p)}`;
    const [, parent, inner] = m;
    const innerCols = inner.split(",").map((x) => x.trim()).map((x) => (x === "*" ? "x.*" : `x.${ident(x)}`)).join(", ");
    return `(select to_jsonb(x2) from (select ${innerCols} from public.${ident(parent)} x where x.id = ${ident(table)}.${ident(singular(parent) + "_id")}) x2) as ${ident(parent)}`;
  }).join(", ");
}

function toPgParam(v: unknown): unknown {
  if (v !== null && typeof v === "object" && !(v instanceof Date) && !(Array.isArray(v) && v.every((x) => x === null || typeof x !== "object"))) return JSON.stringify(v);
  return v;
}

class Query<T = Row[]> implements PromiseLike<Result<T>> {
  private kind: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private cols = "*";
  private returning: string | null = null;
  private filters: { col: string; op: "=" | "in"; val: unknown }[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private rows: Row[] = [];
  private patch: Row = {};
  private conflict: string | null = null;
  private one = false;

  constructor(private table: string, private asUser: string | null) {}

  select(cols = "*") { if (this.kind === "select") this.cols = cols; else this.returning = cols; return this; }
  insert(rows: Row | Row[]) { this.kind = "insert"; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(row: Row | Row[], opts: { onConflict?: string } = {}) { this.kind = "upsert"; this.rows = Array.isArray(row) ? row : [row]; this.conflict = opts.onConflict ?? "id"; return this; }
  update(row: Row) { this.kind = "update"; this.patch = row; return this; }
  delete() { this.kind = "delete"; return this; }
  eq(col: string, val: unknown) { this.filters.push({ col, op: "=", val }); return this; }
  in(col: string, vals: unknown[]) { this.filters.push({ col, op: "in", val: vals }); return this; }
  order(col: string, opts: { ascending?: boolean } = {}) { this.orders.push({ col, asc: opts.ascending !== false }); return this; }
  single() { this.one = true; return this as unknown as Query<T extends (infer R)[] ? R : T>; }

  private where(params: unknown[]): string {
    if (!this.filters.length) return "";
    return " where " + this.filters.map((f) => {
      params.push(f.op === "in" ? (f.val as unknown[]) : f.val);
      return f.op === "in" ? `${ident(this.table)}.${ident(f.col)}::text = any($${params.length}::text[])` : `${ident(this.table)}.${ident(f.col)} = $${params.length}`;
    }).join(" and ");
  }

  private build(): { sql: string; params: unknown[] } {
    const t = `public.${ident(this.table)}`;
    const params: unknown[] = [];
    const ret = this.returning ? ` returning ${this.returning === "*" ? "*" : this.returning.split(",").map((c) => ident(c.trim())).join(", ")}` : "";
    if (this.kind === "select") {
      const order = this.orders.length ? " order by " + this.orders.map((o) => `${ident(this.table)}.${ident(o.col)} ${o.asc ? "asc" : "desc"}`).join(", ") : "";
      return { sql: `select ${selectList(this.table, this.cols)} from ${t}${this.where(params)}${order}`, params };
    }
    if (this.kind === "delete") return { sql: `delete from ${t}${this.where(params)}${ret}`, params };
    if (this.kind === "update") {
      const sets = Object.entries(this.patch).map(([k, v]) => { params.push(toPgParam(v)); return `${ident(k)} = $${params.length}`; });
      if (!sets.length) throw new HttpError("invalid_input", { field: "row" });
      return { sql: `update ${t} set ${sets.join(", ")}${this.where(params)}${ret}`, params };
    }
    // insert / upsert: one column list from the union of keys; missing keys get DEFAULT
    const keys = [...new Set(this.rows.flatMap((r) => Object.keys(r)))];
    if (!keys.length) throw new HttpError("invalid_input", { field: "row" });
    const values = this.rows.map((r) => "(" + keys.map((k) => {
      if (!(k in r)) return "default";
      params.push(toPgParam(r[k]));
      return `$${params.length}`;
    }).join(", ") + ")").join(", ");
    let sql = `insert into ${t} (${keys.map(ident).join(", ")}) values ${values}`;
    if (this.kind === "upsert") {
      const conflictCols = this.conflict!.split(",").map((c) => c.trim());
      const upd = keys.filter((k) => !conflictCols.includes(k)).map((k) => `${ident(k)} = excluded.${ident(k)}`);
      sql += ` on conflict (${conflictCols.map(ident).join(", ")}) ` + (upd.length ? `do update set ${upd.join(", ")}` : "do nothing");
    }
    return { sql: sql + ret, params };
  }

  async exec(): Promise<Result<T>> {
    try {
      const { sql, params } = this.build();
      const rows = await run(this.asUser, (q) => q(sql, params));
      if (this.one) {
        if (rows.length !== 1) return { data: null, error: { code: "PGRST116", message: `expected one row, got ${rows.length}` } };
        return { data: rows[0] as T, error: null };
      }
      return { data: rows as T, error: null };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      const err = e as PgError;
      return { data: null, error: { code: err.code, message: err.message } };
    }
  }

  then<A = Result<T>, B = never>(ok?: ((v: Result<T>) => A | PromiseLike<A>) | null, bad?: ((r: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.exec().then(ok, bad);
  }
}

// ---------- rpc with typed named arguments ----------
const argTypes = new Map<string, Map<string, string>>();
async function typesOf(fn: string): Promise<Map<string, string>> {
  if (argTypes.has(fn)) return argTypes.get(fn)!;
  const rows = await run(null, (q) => q(
    `select unnest(p.proargnames) as name, format_type(unnest(p.proargtypes::oid[]), null) as type
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn]));
  const m = new Map(rows.map((r) => [String(r.name), String(r.type)]));
  argTypes.set(fn, m);
  return m;
}

// ---------- tokens: HS256 JWT signed with DAWRI_JWT_SECRET ----------
const enc = new TextEncoder();
const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
async function hmacKey() {
  const secret = Deno.env.get("DAWRI_JWT_SECRET");
  if (!secret || secret.length < 32) throw new Error("DAWRI_JWT_SECRET is missing or too short");
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function signToken(user: { id: string; email: string }, days = 14): Promise<{ access_token: string; expires_at: number }> {
  const exp = Math.floor(Date.now() / 1000) + days * 86400;
  const head = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify({ sub: user.id, email: user.email, role: "authenticated", exp })));
  const sig = b64url(await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(`${head}.${body}`)));
  return { access_token: `${head}.${body}.${sig}`, expires_at: exp };
}
export async function verifyToken(jwt: string): Promise<{ id: string; email: string } | null> {
  const [head, body, sig] = jwt.split(".");
  if (!head || !body || !sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(), fromB64url(sig), enc.encode(`${head}.${body}`)).catch(() => false);
  if (!ok) return null;
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(body)));
  if (!claims.sub || typeof claims.exp !== "number" || claims.exp < Date.now() / 1000) return null;
  return { id: claims.sub, email: claims.email };
}

export class PgClient {
  constructor(private asUser: string | null = null) {}
  from(table: string) { return new Query(table, this.asUser); }

  async rpc(fn: string, args: Row = {}): Promise<Result<unknown>> {
    try {
      if (!/^[a-z_][a-z0-9_]*$/.test(fn)) throw new HttpError("invalid_action");
      const types = await typesOf(fn);
      const params: unknown[] = [];
      const named = Object.entries(args).filter(([, v]) => v !== undefined).map(([k, v]) => {
        const t = types.get(k);
        if (!t) throw new Error(`unknown argument ${k} for ${fn}`);
        params.push(t === "jsonb" || t === "json" ? (v === null ? null : JSON.stringify(v)) : toPgParam(v));
        return `${ident(k)} => $${params.length}::${t}`;
      });
      const rows = await run(this.asUser, (q) => q(`select public.${ident(fn)}(${named.join(", ")}) as r`, params));
      return { data: rows[0]?.r ?? null, error: null };
    } catch (e) {
      if (e instanceof HttpError) throw e;
      const err = e as PgError;
      return { data: null, error: { code: err.code, message: err.message } };
    }
  }

  auth = {
    getUser: async (jwt: string) => {
      const u = await verifyToken(jwt);
      return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: "invalid token" } };
    },
  };
}

/** For the auth endpoint: raw query on the owner connection. */
export function query(sql: string, params: unknown[] = []): Promise<Row[]> {
  return run(null, (q) => q(sql, params));
}
/** Same connection-pool helper, acting as an owner (RLS applies). */
export function userIdFromToken(jwt: string) { return verifyToken(jwt); }

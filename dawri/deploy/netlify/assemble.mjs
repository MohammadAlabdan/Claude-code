// Builds a ready-to-deploy Netlify project (static app + functions + Netlify Database migrations) from this repository.
//   node dawri/deploy/netlify/assemble.mjs <out-dir> [--site-url https://x.netlify.app] [--vapid-public KEY] [--no-seed]
// Nothing secret is written: DAWRI_JWT_SECRET, CRON_SECRET and VAPID_PRIVATE_KEY live in the Netlify environment.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeEntries } from "./gen-entries.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");           // dawri/
const repo = resolve(root, "..");              // repository root
const args = process.argv.slice(2);
const out = resolve(args[0] ?? "netlify-build");
const opt = (k, d = "") => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const seed = !args.includes("--no-seed");

if (existsSync(out)) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. static app
const pub = join(out, "public");
cpSync(join(root, "web"), pub, { recursive: true });
writeFileSync(join(pub, "config.js"), `// Netlify build: real backend (Netlify Functions + Netlify Database).
window.DAWRI_CONFIG = {
  BACKEND: "netlify",
  DEMO_MODE: false,
  SHOW_DEMO_ACCOUNTS: ${seed},
  VAPID_PUBLIC_KEY: "", // fetched from /api/config at startup
};
`);
if (existsSync(join(repo, "site/index.html"))) {
  mkdirSync(join(pub, "about"), { recursive: true });
  cpSync(join(repo, "site/index.html"), join(pub, "about/index.html"));
}
// SPA fallback, but never for the API routes
writeFileSync(join(pub, "_redirects"), "/*    /index.html   200\n");

// 2. functions: shared code + entries
cpSync(join(root, "supabase/functions"), join(out, "src"), { recursive: true, filter: (p) => !p.endsWith("_test.ts") });
cpSync(join(here, "lib"), join(out, "lib"), { recursive: true });
const fnDir = join(out, "netlify/functions");
writeEntries(fnDir);
for (const f of readdirSync(join(here, "functions"))) cpSync(join(here, "functions", f), join(fnDir, f));

// 3. database migrations (applied by Netlify on every deploy, in name order, never edited once applied)
const mig = join(out, "netlify/database/migrations");
mkdirSync(mig, { recursive: true });
const shim = readFileSync(join(root, "scripts/local-db/supabase_shim.sql"), "utf8");
writeFileSync(join(mig, "20261030000000_netlify_shim.sql"), `-- Netlify Database: the Supabase objects the migrations expect (roles, auth.users, auth.uid(), storage tables).
${shim}
-- the owner connection switches to "authenticated" for owner catalog writes, so RLS applies as on Supabase
grant anon, authenticated, service_role to current_user;
`);
for (const f of readdirSync(join(root, "supabase/migrations")).sort()) cpSync(join(root, "supabase/migrations", f), join(mig, f));
// secrets generated inside the database, never typed or seen by anyone (see lib/secrets.mts)
writeFileSync(join(mig, "20261112080000_netlify_secrets.sql"), `create table if not exists public.app_secrets (
  name text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
insert into public.app_secrets(name, value) values
  ('jwt_secret', encode(extensions.gen_random_bytes(32), 'hex')),
  ('cron_secret', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (name) do nothing;
`);
if (seed) writeFileSync(join(mig, "20261112090000_demo_seed.sql"), readFileSync(join(root, "supabase/seed.sql"), "utf8"));
// test site: the three demo shops stay open around the clock so they can be tried at any hour
if (seed) writeFileSync(join(mig, "20261113000100_demo_open_all_day.sql"), `update public.branches
   set hours = (select jsonb_object_agg(d, '[["00:00","00:00"]]'::jsonb) from unnest(array['sun','mon','tue','wed','thu','fri','sat']) d)
 where public_id in ('rukn2026', 'aseel2026', 'lamaa2026');
`);

// 4. project files
const deno = JSON.parse(readFileSync(join(root, "supabase/functions/deno.json"), "utf8")).imports;
const ver = (k) => deno[k].replace(/^npm:/, "").replace(/^(@?[^@]+)@/, "");
writeFileSync(join(out, "package.json"), JSON.stringify({
  name: "dawri-netlify", private: true, type: "module",
  dependencies: {
    "@netlify/functions": "^5.0.0", "@netlify/blobs": "^10.0.0", "@netlify/database": "2.0.3",
    "@supabase/supabase-js": ver("@supabase/supabase-js"), "web-push": ver("web-push"),
    "@anthropic-ai/sdk": ver("@anthropic-ai/sdk"), zod: ver("zod"), pg: ver("pg"),
  },
}, null, 2));
writeFileSync(join(out, "netlify.toml"), `[build]
  publish = "public"
  command = "echo 'static app, no build step'"

[functions]
  node_bundler = "esbuild"
`);
console.log(`Netlify project written to ${out}`);

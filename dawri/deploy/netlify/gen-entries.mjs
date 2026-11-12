// Writes the thin Netlify function entries that wrap the shared handlers in src/<name>/index.ts.
// Called by assemble.mjs; kept separate so the list of functions lives in one place.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const HTTP = ["customer", "staff", "owner", "onboard", "ai", "admin"];
export const CRON = { maintenance: "*/15 * * * *", "daily-summary": "1,16,31,46 * * * *" };

export function writeEntries(dir) {
  mkdirSync(dir, { recursive: true });
  for (const name of HTTP) {
    writeFileSync(join(dir, `${name}.mts`), `import "../../lib/deno.mts";
import type { Config } from "@netlify/functions";
import { ensureSecrets } from "../../lib/secrets.mts";
import handler from "../../src/${name}/index.ts";

export default async (req: Request) => { await ensureSecrets(); return handler(req); };
// Same URL the app uses with Supabase, so the frontend only changes its base address.
export const config: Config = { path: "/functions/v1/${name}" };
`);
  }
  for (const [name, schedule] of Object.entries(CRON)) {
    writeFileSync(join(dir, `${name}.mts`), `import "../../lib/deno.mts";
import type { Config } from "@netlify/functions";
import { ensureSecrets } from "../../lib/secrets.mts";
import handler from "../../src/${name}/index.ts";

// Runs on a schedule (UTC). Calls the shared handler the way pg_cron does on Supabase.
export default async () => {
  await ensureSecrets();
  const res = await handler(new Request("https://internal/${name}", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: \`Bearer \${process.env.CRON_SECRET ?? ""}\` },
    body: "{}",
  }));
  console.log("${name}", res.status, await res.text());
};
export const config: Config = { schedule: "${schedule}" };
`);
  }
}

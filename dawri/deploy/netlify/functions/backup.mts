// Scheduled: daily backup at 00:37 UTC (03:37 Riyadh, when shops are closed).
import "../../lib/deno.mts";
import type { Config } from "@netlify/functions";
import { ensureSecrets } from "../../lib/secrets.mts";
import { runBackup } from "../../lib/backup.mts";

export default async () => {
  await ensureSecrets();
  console.log("backup", JSON.stringify(await runBackup()));
};
export const config: Config = { schedule: "37 0 * * *" };

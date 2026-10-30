// Serves the pinned CDN packages from local node_modules during tests (CI sandboxes often block jsDelivr).
// Production always loads them from the CDN; the files are byte-identical npm releases.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = (name) => { for (const base of [process.cwd(), process.env.DAWRI_CDN_MIRROR ?? ""]) { try { return dirname(require.resolve(`${name}/package.json`, { paths: [base] })); } catch { /* next */ } } return null; };

export async function mirrorCdn(page) {
  await page.route(/cdn\.jsdelivr\.net\/npm\//, async (route) => {
    const url = new URL(route.request().url());
    const m = url.pathname.match(/^\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/]+\/(.*)$/);
    const dir = m && pkgDir(m[1]);
    const file = dir && join(dir, m[2]);
    if (!file || !existsSync(file)) return route.abort();
    const type = file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "text/javascript" : file.endsWith(".woff2") ? "font/woff2" : "application/octet-stream";
    route.fulfill({ status: 200, contentType: type, body: await readFile(file) });
  });
}

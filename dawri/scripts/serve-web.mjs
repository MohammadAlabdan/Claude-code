// Tiny static server for web/ with the same SPA fallback as Netlify's _redirects.
// Run: node scripts/serve-web.mjs [port]   (default 8888)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../web/", import.meta.url));
const port = Number(process.argv[2] ?? process.env.PORT ?? 8888);
// BASE=/Claude-code/ serves the app under a sub-path, the way GitHub Pages does.
const BASE = process.env.BASE ?? "/";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (BASE !== "/") {
    if (!path.startsWith(BASE)) { res.writeHead(404).end("not found"); return; }
    path = "/" + path.slice(BASE.length);
  }
  let file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try { if ((await stat(file)).isDirectory()) file = join(file, "index.html"); } catch { file = join(root, "index.html"); }
  try {
    let body = await readFile(file);
    if (BASE !== "/" && file.endsWith("index.html")) body = Buffer.from(String(body).replace('<base href="/">', `<base href="${BASE}">`));
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(body);
  } catch { res.writeHead(404).end("not found"); }
}).listen(port, () => console.log(`Dawri web on http://localhost:${port}`));

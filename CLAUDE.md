# «جاي» — rules for every session

The owner is an Arabic-speaking beginner. **Reply in Arabic only**, in plain words.

## After ANY change (the owner's standing rule)
A change is not done until everything that describes it is updated, published, and pushed:

1. **App and tests**
   - `dawri/web` and `dawri/supabase`.
   - Add a new migration and **never edit an applied one**. New prefixes must be higher than the last one; `20261117000100_go_live.sql` exists only in the Netlify build.
   - Run pgTAP with `dawri/scripts/local-db/reset.sh --test`.
   - Run Playwright from `dawri/` after `node scripts/serve-web.mjs 8899`, with `DAWRI_CDN_MIRROR=<scratchpad>/tools npx playwright test --trace off`.
   - Bump the cache name in `dawri/web/sw.js` when web files change.
2. **Marketing pages** (`site/`). Update each one that mentions the change:
   - `dawri.html`: the intro site, with its features, plans and FAQ.
   - `infographics.html`: customer, staff and owner steps. Re-export the PNGs to `site/infographics/`.
   - `competitors.html`: comparison rows.
   - `readiness.html`: date, test counts, «أهم ما نُفّذ», items and suggestions, the runbook, and «ما أحتاجه منك».
   - `social.src.html`: the post studio.
   - `brand/`: logos and the brand guide.
   - Then run `bash build.sh`.
3. **Republish the artifacts**, using the same file path so the URL stays:

   | Page | File | URL |
   |---|---|---|
   | Intro site | `site/dawri.html` | https://claude.ai/artifact/71xDAEiu7GMYG2UDgz2KzK |
   | Infographics | `site/infographics.html` | https://claude.ai/artifact/Xjc7oDjeTz1rs2vLcLiPmp |
   | Competitors | `site/competitors.html` | https://claude.ai/artifact/4CMZyMesQwptJs17GFALhE |
   | Readiness | `site/readiness.html` | https://claude.ai/artifact/Rr9ZSXyjmr7rWzELq8Q92V |
   | Social studio | `site/social.html` | https://claude.ai/artifact/JMa5tjfTUXCJhCuWJAaveX (capability: downloads) |
   | Roadmap | `site/roadmap.html` | https://claude.ai/artifact/BZzxSL2nDaZH23fqNrfKpT (capability: db; tasks live in its `tasks` collection) |

   **Roadmap upkeep.** After finishing work that matches a roadmap task, mark it done with `ArtifactData` `update` (`done: true`, `done_at`, pinned with `if_version`). Add new planned work as a task (`phase` p1–p6, `owner` you|claude, `order`, `custom: false`). Never untick or delete the owner's own ticks or tasks.

4. **Deploy the live site**
   - Run `node dawri/deploy/netlify/assemble.mjs <scratch>/nl-build`.
   - Get a fresh command from the Netlify MCP `deploy-site` (siteId `97b108a5-ef6d-4d39-a312-67c6c74310cb`).
   - Run it in that folder with `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`.
   - Then check https://jay-live.netlify.app/api/health.
5. **Commit and push** to `claude/new-session-kshbvu` and to `main`. Do not open PRs unless asked.
6. **Tell the owner what changed, with every link:**
   - Live: `/s/<shop>`, `/owner`, `/admin` (its «المبيعات» tab holds quotes, invoices, products, the agreement and business details), `/start`, `/about/`, `/studio/`, `/privacy`, `/brand/`
   - Documents: a quote at `/q/<token>`, plus `/doc/invoice/<id>` and `/doc/contract/<id>`
   - The six artifact URLs above.

## Never
- Put secrets in code or chat.
  - Keys are generated in the DB (`app_secrets`), or the owner types them into the admin dashboard (for example `whatsapp_config`).
  - Never send the owner's email or personal data to outside services.
- Use unofficial WhatsApp libraries. Use only the Meta Cloud API.

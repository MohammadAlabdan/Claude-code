# Decisions

One line each: defaults chosen where the brief left room, and what was verified.

## Backend (Part 1)

- Business logic lives in SQL functions (`c_*` customer, `s_*` staff, `o_*` owner, `a_*` admin); Edge Functions authenticate, validate, call one function, then send pushes and the broadcast it returns. Keeps every rule testable in Postgres and atomic.
- SQL actions return `{"error": code, …}` for business failures instead of raising, so nothing is half-written and the API maps codes to Arabic/English messages in one place (`_shared/errors.ts`).
- Internal functions are `revoke`d from `anon`/`authenticated`; only `public_branch` and `public_ticket` are callable anonymously. All tables have RLS; `anon` has no table grants.
- `position` = number of waiting tickets ahead (0 = next). "Return now" fires when `position <= return_now_threshold` (default 2 → «باقي قبلك دوران»).
- Return-now push is only marked as sent for tickets that have push enabled, so a customer who enables alerts later can still get it.
- A ticket with a chosen provider competes with tickets for that provider and "any provider" tickets; its estimate divides by 1. A ticket for "any" divides by the number of active providers for the service.
- Service minutes = median of the last 30 completed tickets, used only once there are at least 3, otherwise `services.avg_minutes`.
- `call_next` also finishes whatever this device called before (one-button flow); explicit `serve`/`done`/`no_show` still exist.
- Snoozing or pushing back clears `priority` on that ticket so ordering stays simple.
- Busy level: `free` ≤ 2 waiting, `some` ≤ 6, `busy` above; a manual level from staff/owner wins for 30 minutes.
- Receipt-mode tickets get a deterministic token (HMAC of ticket id with the branch secret), so typing the same receipt code again returns the same ticket on any phone. The receipt code is the credential in this mode by design.
- Receipt "ready" is stored as status `done` (+ `ready: true` in the view); dropoff "ready" is status `called` + stage `ready`; `picked_up` → `done`.
- Dropoff tickets are not cancelled at day end (cars/devices can stay overnight); they are cancelled after 7 days.
- Day end: unfinished non-dropoff tickets are cancelled 60 minutes after that day's last closing time (or end of day if no hours), by the `maintenance` cron.
- Branch hours JSON: `{"sun":[["HH:MM","HH:MM"]],…}`; a close ≤ open runs past midnight. `["00:00","00:00"]` = open 24 h. A branch with no hours is closed.
- Busy alert re-arms when the waiting count drops below the threshold (checked on every action and by the cron), and fires at most once an hour.
- Rotating code: HMAC-SHA256 digest read as a big-endian integer mod 10000; the same implementation in SQL and TypeScript, checked against a shared vector (`1815`) and an independent Node HMAC.
- Join rate limit uses a 16-byte SHA-256 of `IP|User-Agent`; buckets are fixed clock hours (simplest correct "per hour").
- Expired `plan_until` or `is_active = false` → no features at all (account paused); a running trial always means `full`.
- `staff_language` gates non-Arabic device languages (it is in every plan, so effectively always allowed; kept for the contract).
- Staff devices can be tied to a provider (`staff_devices.provider_id`), so each barber's screen calls from their own line by default.
- Providers get an optional `service_ids uuid[]` (null = all services) to model "optional per service".
- Onboarding creates a random ASCII slug (`d-xxxxxxxx`) because shop names are Arabic; the display name stays Arabic. Max 5 businesses per account.
- Owner catalog CRUD runs through the owner's own JWT so RLS (and plan checks inside the insert/update policies) decide; the function checks the feature first to return the `feature_locked` shape.
- Broadcast is sent from Edge Functions through the Realtime REST endpoint (`/realtime/v1/api/broadcast`), public channel `branch:{public_id}`, payload without personal data.
- Push payload `url` is `/s/{public_id}`; the frontend redirects to the active ticket kept in `localStorage`.
- All functions use `verify_jwt = false` and authenticate in code (ticket token, device token, owner JWT, or service key for cron). Works with the new publishable keys too.
- AI: official Anthropic TypeScript SDK (`npm:@anthropic-ai/sdk@0.135.0`) with models from secrets (defaults `claude-haiku-5-5` fast, `claude-sonnet-5-5` vision, as the brief specifies). Menu extraction uses structured outputs (`messages.parse` + zod schema); prices outside 0–100000 or unreadable become `null`.
- AI refusal or truncation returns `ai_failed` (menu, summary) or the "I don't know" line (Q&A); no server-side model fallback, because each AI feature already has a non-AI path and the owner reviews every result.
- The evening summary uses AI wording only for branches whose plan includes an AI feature (`menu_photo_ai`, i.e. growth and up); everyone else gets the fixed Arabic template.
- AI daily cap (200) is counted per business per Riyadh day from `ai_usage`; Q&A is also limited to 20 questions per visitor per hour.
- Demo data: businesses carry `is_demo = true`; demo users use `@demo.dawri.app`. One statement removes all of it (top of `seed.sql`).
- Demo staff pairing tokens are fixed strings (see README) so the demo can be opened without the owner app; real devices always get random tokens.
- Postgres functions use `security definer` with `search_path = public`; pgcrypto is referenced as `extensions.*` as on Supabase.

## Checks that ran (Part 1)

- Supabase CLI and Docker daemon are not available in this environment, so `supabase start / db reset / test db` did not run.
- Instead: all migrations + `seed.sql` loaded into a local PostgreSQL 16.15 with a small Supabase shim (`scripts/local-db/supabase_shim.sql`: roles, `auth.users`, `auth.uid()`, storage tables). `pg_cron`/`pg_net` are not installed locally, so the cron migration skipped itself with a notice.
- pgTAP 1.x: `supabase/tests/*.sql` — 64 assertions pass (numbering, ordering with priority/snooze/push-back, remote limit, closed/closing-soon, rate limit, receipt idempotency, dropoff claim, RLS for anon and owner A vs B, feature gating, trial/expiry, loyalty consent and single counting, rotating code).
- Real concurrency: `supabase/tests/concurrency.sh` — 40 parallel connections get numbers 1..40 with no gaps; 20 parallel walk-ins get distinct numbers.
- Deno 2.9.6: `deno check` passes on all 8 functions; `deno test` passes 13 tests for `_shared/logic.ts` (estimates, rotating code vector, Riyadh time, phone validation, quiet hours, summary template).
- End-to-end: the `customer`, `staff` and `maintenance` functions ran under Deno against the local database through `scripts/local-db/fake-rest.ts` (a stand-in for the REST gateway): join, remote limit, snooze, call next, walk-in, leave, feedback guard, receipt ready-before-scan, dropoff + claim, Bengali staff labels, broadcast payloads, cron auth.
- Not exercised locally: real Web Push delivery (VAPID keys were generated and accepted by `web-push`), Supabase Auth sign-in, Storage uploads, and live Claude calls (no API key here).

## Frontend (Part 2)

- Lives in `dawri/web/` (the repo root already holds the marketing site in `site/`). Plain HTML + ES modules + two CSS files; no build.
- One small DOM helper (`h()`) instead of a framework; screens are lazy-loaded modules (`js/screens/*.js`), so the customer pages never load owner/staff code.
- supabase-js is loaded only in real mode, from jsDelivr's ESM build (`@supabase/supabase-js@2.45.4/+esm`); demo mode needs no external JS. qrcode-generator is loaded on demand as a classic script (`window.qrcode`), with the link shown as text if the CDN fails.
- Edge Functions are called with `fetch` (not `functions.invoke`) to send `x-device-token` and read the `{error, message_ar, message_en}` body directly.
- The owner, onboarding and admin screens are Arabic only (strings in the modules); customer screens have Arabic/English (`i18n/customer.*.json`), staff screens five languages (`i18n/staff.*.json`). Server error messages show in Arabic for ar devices and in English for the other staff languages.
- Arabic-Indic digits everywhere in Arabic UI (`show_arabic_digits`); the LED board, keypad and codes use Western digits in the Doto face.
- Demo mode keeps its state in `localStorage` and shares changes between tabs with `BroadcastChannel`, so customer and staff pages in two tabs behave like the real system. Only one tab advances the demo every ~15 s (a timestamp lock); `localStorage["dawri.demo.auto"] = false` stops it (the tests do this).
- Demo data re-seeds itself each Riyadh day; demo shops are open 24 hours so the demo works at any time.
- Demo mode has no push server: enabling alerts asks for permission and marks the ticket; the ticket page itself vibrates, chimes and shows a local notification when called/ready.
- Ticket alerts: vibration on return-now, called and ready; the chime plays only after the first tap unlocked audio.
- The shop page sends a returning customer straight to their active ticket (`dawri.ticket.<public_id>`); `?stay` keeps them on the shop page.
- Staff offline queue: taps made while offline are stored in `localStorage` and replayed in order when the browser is back online; a dot in the top bar shows synced/pending.
- "Open staff screen" from the owner app means pairing a device (Settings → devices), because staff screens authenticate as devices, not owners.
- The printable poster uses `window.print()` with A5/A4 `@page` rules; it is the only place that calls print.
- Icons: Tabler Icons webfont 3.19.0 from jsDelivr. PWA icons are rendered from `assets/logo.svg` by `scripts/make-icons.mjs` (Playwright).
- `dawri-web.zip` is written by a dependency-free ZIP writer (`scripts/package-web.mjs`), contents of `web/` at the zip root.
- The service worker caches the shell (network-first for pages, stale-while-revalidate for own files) and handles `push` / `notificationclick`; it opens `/s/<public_id>`, which redirects to the active ticket.
- Tests mirror the pinned jsDelivr packages from local npm copies (`tests/e2e/cdn.js`) because this build sandbox blocks jsDelivr; the files are the same npm releases the CDN serves.

## Checks that ran (Part 2)

- Playwright 1.63 (Chromium), demo mode, 390×844: `tests/e2e` — 10 tests pass: remote join → staff calls → full-screen «حان دورك» → done → 👍 feedback → Google review button + loyalty prompt; receipt scan → kitchen keypad marks ready → «طلبك جاهز»; dropoff register → QR claim link → stage changes → «جاهزة للاستلام»; staff in Urdu renders RTL and in Bengali LTR; owner dashboard and «نبضي» show lost customers in SAR and the absent list; basic-plan owner sees lock cards with the required plan; unpaired device message; no horizontal scroll at 360 px on 18 routes (customer, ticket, staff ×3, owner ×5, poster, onboarding, admin, gallery, 404); screenshots in light and dark saved to `screenshots/`.
- Every screen loaded with no console errors in a separate smoke run.
- Size: a customer's first load (shell, shop page, shared components, Arabic strings) is ~74 KB of our own HTML/JS/CSS/JSON in real mode (~140 KB in demo mode, which adds the in-browser backend); owner and staff modules load only on their routes.
- `dawri-web.zip` built and verified with Python's `zipfile.testzip()`.
- Not exercised here: the real Supabase backend from the browser (no project keys in this environment), real Web Push delivery, and iPhone Safari.

## «تحدّياتي» and the waiting showcase (added 2026-11-02)

- Challenges are counted from finished tickets (no stamps, no scanning): a customer starts a challenge on their ticket with a consented phone, and every later finished ticket with that phone that matches the challenge adds one visit. The reward is redeemed with the rotating staff code.
- Duration is per challenge (`starts_at`–`ends_at`), like the editor in the reference video; visits must fall inside it.
- Plans: simple visit challenges and «أبيها» in growth; time-window, comeback, provider and friend challenges (`smart_quests`) in full.
- Suggestions are computed from the shop's own numbers (quietest 2-hour window, absent customers, least busy provider) and open the same 4-step editor prefilled.
- No rewards for Google reviews (against Google's policy) and no public leaderboards (minimal personal data); participant counts are shown without names.
- Existing views were extended by renaming them (`ticket_view_base`, `public_branch_base`, `s_state_base`) and wrapping them, so the earlier migrations stay untouched.
- The ticket page order is now: board, ticket, alerts, «وأنت تنتظر» showcase, queue line, actions. The showcase is a story-style carousel (challenges, offers, extras) that auto-advances every 6 s until touched and never with reduced motion; it keeps its position across live refreshes.
- «أبيها» shows extras only, never the service already booked; staff see them as amber badges on the ticket.
- Checks: 5 SQL test files (78 assertions, 14 for challenges), 14 Deno tests (one for suggestions), Playwright suite extended with the challenge flow, the owner designer and the locked card.

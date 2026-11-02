# Dawri API contract

Everything the frontend (Part 2) may call. All JSON, UTF-8. Times are ISO-8601 UTC; every business rule (days, hours, reports) uses `Asia/Riyadh`.

## 1. Transport

| Kind | How | Auth |
|---|---|---|
| Public read RPC | `POST {SUPABASE_URL}/rest/v1/rpc/<name>` (or `supabase.rpc(name, args)`) | anon key only |
| Edge Function | `POST {SUPABASE_URL}/functions/v1/<function>` with body `{ "action": "...", ...fields }` (or `supabase.functions.invoke`) | see each function |
| Realtime | Broadcast channel `branch:{public_id}` | anon key |
| Storage | bucket `branch-photos` (public read), path `<branch_id>/<file>` | owner JWT to write |

Headers for Edge Functions: `apikey: <anon key>`, `Content-Type: application/json`, plus:
- `customer`, `ai` (`qa`, `status`): nothing else.
- `staff`: `x-device-token: <pairing token>`.
- `owner`, `onboard`, `ai` (`menu_from_photo`, `summary_text`), `admin`: `Authorization: Bearer <user access token>`.
- `daily-summary`, `maintenance`: `Authorization: Bearer <service role key>` (cron only).

Every function answers `OPTIONS` for CORS and only accepts `POST`.

## 2. Errors

Failure → non-2xx status and:

```json
{ "error": "remote_limit", "message_ar": "…", "message_en": "…", "busy_level": "busy" }
```

Show `message_ar` (or `message_en`) to the user. Extra fields depend on the code.

| code | status | extra fields |
|---|---|---|
| `invalid_json`, `invalid_action` | 400 | |
| `invalid_input` | 400 | `field`, sometimes `detail` |
| `invalid_service`, `invalid_provider`, `invalid_party_size`, `invalid_receipt_code`, `invalid_steps`, `invalid_subscription`, `invalid_phone`, `invalid_code`, `consent_required` | 400 | |
| `unauthorized` | 401 | |
| `device_unpaired` | 401 | |
| `forbidden` | 403 | |
| `feature_locked` | 403 | `feature`, `required_plan` (`basic`/`growth`/`full`) |
| `branch_not_found`, `ticket_not_found`, `offer_not_found`, `not_found` | 404 | |
| `closed` | 409 | `next_open_at`, `busy_level` |
| `closing_soon` | 409 | `next_open_at`, `busy_level` |
| `remote_limit` | 409 | `busy_level` |
| `invalid_state`, `not_waiting`, `not_done`, `snooze_limit`, `feedback_exists`, `no_reward`, `offer_inactive`, `already_redeemed`, `too_many_businesses` | 409 | |
| `image_too_large` | 413 | |
| `rate_limited`, `ai_limit` | 429 | |
| `server_error` | 500 | |
| `ai_failed` | 502 | |
| `ai_unavailable` | 503 | |

The public RPCs return `{ "error": "branch_not_found" }` / `{ "error": "ticket_not_found" }` with HTTP 200 instead (no message fields); map them with the same table.

## 3. Feature keys and plans

| plan | price (SAR/month) | features |
|---|---|---|
| `basic` | 199 | `queue`, `fadeet`, `return_now`, `card`, `evening_summary`, `late_button`, `family_ticket`, `priority`, `lost_customers`, `staff_language` |
| `growth` | 399 | basic + `menu`, `menu_photo_ai`, `timed_offers`, `loyalty`, `feedback`, `preferred_provider`, `best_time`, `busy_alert`, `quests`, `upsell` |
| `full` | 699 | growth + `full_page`, `news`, `qa_assistant`, `quiet_coupon`, `peak_report`, `absent_customers`, `smart_quests` |
| `seasonal` | by season | same as basic until `plan_until` |

A trial (`trial_until` in the future) counts as `full`. An inactive business or expired `plan_until` has **no** features. Responses carry `features: string[]` so the UI can show locked cards.

## 4. Shared shapes

### Ticket (`TicketView`)

```json
{
  "id": "uuid", "number": 24, "mode": "remote|receipt|dropoff",
  "status": "waiting|called|serving|done|no_show|cancelled|left",
  "stage": "received|in_progress|ready|picked_up|null",
  "receipt_code": "47|null", "item_label": "كامري بيضاء|null", "party_size": 1,
  "service": { "id": "uuid", "name": "حلاقة شعر" },
  "provider": { "id": "uuid", "name": "كرسي ١" } ,
  "position": 3,            // waiting tickets ahead (0 = next); remote+waiting only, else null
  "estimate_min": 45,       // remote+waiting only; rounded to 5, min 5; show as «تقريباً»
  "return_now": false,      // position <= return_now_threshold
  "called": false,          // remote and status called/serving
  "ready": false,           // receipt: done; dropoff: stage ready
  "now_serving": 21,        // highest called/serving number today in this service
  "waiting_in_service": 4,
  "snooze_left": 2,
  "push_enabled": false,
  "has_phone": false,
  "lang": "ar|en",
  "joined_at": "…", "called_at": "…|null", "done_at": "…|null",
  "feedback": { "positive": true } ,      // null until given
  "loyalty": { "visits": 3, "goal": 6, "reward_available": false, "reward_text": "الزيارة السادسة علينا" },  // null without phone or feature
  "offers": [Offer],
  "features": ["queue", "…"],
  "branch": { "public_id": "aseel2026", "name": "…", "business_name": "…", "phone": "011…", "show_arabic_digits": true },
  "quests": [Quest],          // open challenges (feature quests), with "mine" when the ticket has a phone
  "showcase": [{ "id", "name", "category", "description", "price_sar", "duration_min" }],  // extras for «أبيها», never the booked service
  "interests": ["menu item id"]
}
```

### Quest («تحدّياتي»)

```json
{ "id": "uuid", "kind": "visits|quiet|comeback|provider|friend", "title": "…", "description": "…", "required_visits": 3,
  "reward_text": "خصم ١٥٪", "rarity": "common|rare", "ends_at": "…", "weekdays": [0,1,2,3,4,5,6],
  "time_start": "15:00:00|null", "time_end": "17:00:00|null", "service": "name|null", "provider": "name|null",
  "participants": 14, "spots_left": 6, "mine": { "visits": 1, "completed": false, "redeemed": false } }
```

A visit counts automatically when a ticket with that phone is finished and matches the quest (service, provider, time window for `quiet`, 2+ people for `friend`, inside starts_at–ends_at). `visits` needs `quests`; the other kinds need `smart_quests`.

`provider` is `null` when any provider is fine.

### Offer

```json
{ "id": "uuid", "kind": "timed|quiet_coupon", "title": "…", "terms": "…|null", "discount_text": "٢٠٪|null",
  "start_time": "15:00:00|null", "end_time": "17:00:00|null" }
```

Only offers active **right now** (weekday, time window, dates, remaining redemptions, plan feature) are ever returned to customers.

## 5. Public RPCs (anonymous)

### `public_branch(p_public_id text)`

```json
{
  "branch": { "public_id": "aseel2026", "name": "…", "business_name": "…", "category": "barber", "address": "…", "map_url": "…",
              "phone": "011…", "hours": { "sun": [["09:00","03:00"]], "…": [] }, "open": true,
              "closes_at": "…|null", "next_open_at": "…|null", "busy_level": "free|some|busy", "waiting": 5,
              "show_arabic_digits": true, "remote_join_limit": 5 },
  "features": ["…"],
  "services": [{ "id": "uuid", "name": "…", "mode": "remote", "avg_minutes": 20, "now_serving": 5, "waiting": 3, "estimate_min": 20 }],
  "providers": [{ "id": "uuid", "name": "كرسي ١ · أبو سعد", "service_ids": null }],   // [] unless preferred_provider
  "ready_numbers": ["44", "43"],                 // receipt mode, today, newest first, max 20
  "page": { "bio": "…", "photos": ["<branch_id>/a.jpg"], "highlights": ["…"] },        // null unless full_page
  "menu": [{ "id": "uuid", "category": "…", "name": "…", "description": "…", "price_sar": 40, "duration_min": 20 }],  // [] unless menu
  "offers": [Offer],
  "best_time": { "arrivals": [[0.0 × 24] × 7], "open": [[bool × 24] × 7] },      // null unless best_time; row 0 = Sunday
  "news": [{ "id": "uuid", "title": "…", "body": "…", "published_at": "…" }],          // [] unless news
  "server_time": "…"
}
```

Hours: `{"sun": [["HH:MM","HH:MM"], …], …}`; a close time ≤ open time runs past midnight. Photo URLs: `{SUPABASE_URL}/storage/v1/object/public/branch-photos/<path>`.
Busy level: manual level if staff/owner set one in the last 30 minutes, else `free` ≤ 2 waiting, `some` ≤ 6, `busy` above.

### `public_ticket(p_token text)` → `TicketView`

## 6. `customer` function (anonymous)

| action | request | response |
|---|---|---|
| `ticket` | `{token}` | `TicketView` |
| `join` | `{public_id, service_id, provider_id?, party_size (1–6, default 1), lang?}` | `{ticket_token, ticket: TicketView}` |
| `join_receipt` | `{public_id, service_id, receipt_code, lang?}` | `{ticket_token, ticket}`; same code same day → same ticket and token; if the kitchen already marked it, `ticket.ready = true` |
| `subscribe_push` | `{token, subscription: PushSubscriptionJSON}` | `{ok, push_enabled: true}` |
| `snooze` | `{token, steps: 1|2}` | `{ok, ticket}` (feature `late_button`) |
| `leave` | `{token}` | `{ok, ticket}` |
| `feedback` | `{token, positive, reason?: long_wait|quality|treatment|price|other, note? (≤280)}` | `{ok, google_review_url: string|null}` (feature `feedback`, once, after done) |
| `set_phone` | `{token, phone: "05XXXXXXXX", consent: true}` | `{ok, loyalty}` (feature `loyalty`) |
| `redeem` | `{token, offer_id, code}` or `{token, loyalty: true, code}` | `{ok, redeemed: "offer"|"loyalty", title, loyalty?}` |
| `claim_dropoff` | `{claim_token}` | `{ticket_token, ticket}`; the claim link works once |
| `quest_start` | `{token, quest_id}` | `{ok, quests: [Quest]}` — needs a phone on the ticket (`phone_required`); `quest_full`, `quest_ended`, `quest_not_eligible` |
| `redeem_quest` | `{token, quest_id, code}` | `{ok, redeemed: "quest", title, quests}` (rotating staff code) |
| `interest` | `{token, item_id, on?: bool}` | `{ok, interests: [menu item ids]}` — «أبيها» (feature `upsell`, max 5) |

Store `ticket_token` per branch in `localStorage` (`dawri.ticket.<public_id>`). Join rate limit: 3 per device (IP+UA) per branch per hour; 30 actions per ticket per hour. Join refusals: `closed`, `closing_soon`, `remote_limit`, `rate_limited`.

## 7. `staff` function (`x-device-token`)

| action | request | response |
|---|---|---|
| `state` | – | `StaffState` (below) |
| `call_next` | `{service_id?, provider_id?}` (provider defaults to the device's) | `{ok, ticket: TicketView|null, empty?: true}`. Also finishes the ticket this device called before. |
| `call_ticket` | `{ticket_id}` | `{ok, ticket}` |
| `serve` | `{ticket_id}` | `{ok}` |
| `done` | `{ticket_id}` | `{ok}` |
| `push_back` | `{ticket_id}` | `{ok, status: "waiting"|"no_show"}` (first time: back 2 places; second: no-show) |
| `no_show` | `{ticket_id}` | `{ok}` |
| `add_walk_in` | `{service_id, party_size?, provider_id?}` | `{ok, ticket_id, number, position, estimate_min}` |
| `mark_ready` | `{receipt_code}` | `{ok, receipt_code, customer_linked}` |
| `dropoff_create` | `{service_id, item_label}` | `{ok, ticket_id, number, claim_token, claim_url}` → render `claim_url` as a QR |
| `dropoff_stage` | `{ticket_id, stage: received|in_progress|ready|picked_up}` | `{ok, stage}` |
| `set_priority` | `{ticket_id, reason: elderly|pregnant|disability|other}` | `{ok}` |
| `set_busy` | `{level: free|some|busy|null}` | `{ok, busy_level}` |
| `rotating_code` | – | `{code: "4827", expires_in: 37}` (seconds) |
| `redeem_check` | – | `{redemptions: [{id, redeemed_at, ticket_number, kind, title}]}` |

`StaffState`:

```json
{
  "device": { "id", "label", "language": "ar|en|ur|bn|fil", "provider_id" },
  "branch": { "id", "public_id", "name", "busy_level", "manual_busy", "open", "settings": {…}, "features": [] },
  "services": [{ "id", "name", "mode", "avg_minutes", "now_serving", "waiting" }],
  "providers": [{ "id", "name", "service_ids" }],
  "tickets": [{ "id", "number", "mode", "status", "stage", "service_id", "provider_id", "party_size", "priority", "priority_reason",
                "push_enabled", "source", "receipt_code", "item_label", "push_back_count", "joined_at", "called_at",
                "called_by_me", "position", "interests": ["names of extras the customer asked for"] }],          // queue order; waiting/called/serving + open dropoffs
  "ready_numbers": ["44"],
  "labels": { "waiting": "…", … },                   // status/stage labels in the device language
  "server_time": "…"
}
```

`push_enabled: false` → show the bell-off icon (call the customer by voice).

## 8. `owner` function (owner JWT)

| action | request | response |
|---|---|---|
| `overview` | – | `{is_admin, businesses: [{id, name, slug, category, plan, effective_plan, plan_until, trial_until, trial_days_left, is_active, branches: [{id, name, public_id, address, map_url, phone, google_review_url, hours, settings, features}]}]}` |
| `dashboard` | `{branch_id, range: today|7d|30d}` | `Dashboard` (below) |
| `queue` | `{branch_id}` | `{busy_level, services[], providers[{id,name,waiting,serving}], tickets[]}` |
| `set_busy` | `{branch_id, level}` | `{ok, busy_level}` |
| `devices` | `{branch_id}` | `{devices: [{id, label, language, provider_id, last_seen_at, revoked_at, created_at}]}` |
| `create_staff_device` | `{branch_id, label, language, provider_id?}` | `{ok, device_id, pairing_url}` — shown once |
| `revoke_device` | `{device_id}` | `{ok}` |
| `settings_update` | `{branch_id, settings: {key: value}}` | `{ok, settings}` — keys: the ints `return_now_threshold`, `remote_join_limit`, `remote_close_minutes_before_closing`, `avg_ticket_value_sar`, `busy_alert_threshold`, `snooze_max`, `no_show_push_back`, `loyalty_goal`; `summary_time` "HH:MM"; `show_arabic_digits` bool; `loyalty_reward_text`; `staff_languages` array |
| `subscribe_push` | `{subscription}` | `{ok}` |
| `quiet_hours` | `{branch_id}` | `{arrivals, open, windows: [{weekday, start_hour, avg_arrivals}], busiest}` |
| `suggest_quiet_coupon` | `{branch_id}` | `{suggestion: {kind, title, terms, discount_text, weekdays, start_time, end_time, label_ar, branch_id}|null, locked, required_plan}` → create it with `upsert` on `offers` |
| `list` | `{table, branch_id}` | `{rows}` |
| `upsert` | `{table, row}` (`row.id` updates, else inserts; `business_pages` keys on `branch_id`; `branches` needs `row.id`) | `{ok, row}` |
| `delete` | `{table, id}` | `{ok}` |
| `menu_bulk` | `{branch_id, items: [menu rows], replace?: bool}` | `{ok, inserted}` |
| `quests` | `{branch_id}` | `{quests: [quest row + open, participants, completed, redeemed, visits], interests_7d}` |
| `suggest_quests` | `{branch_id}` | `{suggestions: [{kind, title, description, required_visits, reward_text, rarity, max_participants, weekdays, time_start, time_end, provider_id, duration_days, why, locked, required_plan}]}` → save with `upsert` on `quests` |

Catalog tables and writable columns:

| table | columns | feature |
|---|---|---|
| `services` | branch_id, name, mode, avg_minutes, is_active, sort | – |
| `providers` | branch_id, display_name, service_ids, is_active | – |
| `menu_items` | branch_id, category, name, description, price_sar, duration_min, is_available, sort, service_id | `menu` |
| `offers` | branch_id, kind, title, terms, discount_text, weekdays (0=Sun), start_time, end_time, valid_from, valid_to, max_redemptions, is_active | `timed_offers` / `quiet_coupon` |
| `news_posts` | branch_id, title, body, published_at | `news` |
| `quests` | branch_id, kind, title, description, service_id, provider_id, required_visits, reward_text, rarity, max_participants, weekdays, time_start, time_end, starts_at, ends_at, is_active | `quests` / `smart_quests` |
| `business_pages` | branch_id, bio, photos (storage paths), highlights, is_published | `full_page` |
| `branches` (update only) | name, address, map_url, phone, google_review_url, hours | – |

Owners may also read these tables directly with supabase-js under RLS.

`Dashboard`:

```json
{
  "range": "7d", "from": "2026-10-24", "to": "2026-10-30", "features": [],
  "served": 213, "joined": 238, "avg_wait_min": 8, "satisfaction_pct": 92,
  "lost": { "count": 19, "sar": 950, "avg_ticket_value_sar": 50 },           // null unless lost_customers
  "lost_trend": [{ "day": "2026-10-24", "count": 3 }],
  "arrivals_by_hour": [24 numbers],
  "wait_trend": [{ "day": "…", "avg_wait_min": 8 }],
  "heatmap": { "arrivals": [[…]], "open": [[…]] },                            // null unless peak_report
  "provider_times": [{ "provider_id", "name", "served", "avg_service_min" }], // null unless peak_report
  "negative_feedback": [{ "id", "reason", "note", "created_at", "ticket_number" }],   // null unless feedback
  "absent": [{ "phone", "visits", "last_visit_at", "days_since" }],          // null unless absent_customers
  "redemptions": [{ "id", "redeemed_at", "kind", "title" }],
  "live": { "waiting": 5, "busy_level": "some", "busy_alert": { "armed": true, "last_alert_at": null } },
  "latest_summary": { "day", "text", "stats" },
  "quiet_windows": [{ "weekday", "start_hour", "avg_arrivals" }], "busiest": { "weekday", "hour", "avg_arrivals" }
}
```

## 9. `onboard` function (owner JWT)

Request:

```json
{ "business_name": "حلاق الأصيل", "category": "cafe|restaurant|bakery|barber|salon|clinic|lab|carwash|phone_repair|other",
  "branch_name": "optional", "district": "حي الملقا", "phone": "optional",
  "services": [{ "name": "حلاقة شعر", "mode": "remote", "avg_minutes": 20 }],
  "hours": { "sun": [["09:00","23:00"]], … }, "staff_language": "ar" }
```

`mode` defaults by category (cafés/restaurants/bakeries → `receipt`, car wash/phone repair → `dropoff`, else `remote`).
Response: `{ok, business_id, slug, branch_id, public_id, trial_until, shop_url, pairing_url}` (14-day full trial).

## 10. `ai` function

| action | auth | request | response |
|---|---|---|---|
| `status` | – | – | `{available}` |
| `menu_from_photo` | owner | `{branch_id, image_base64}` (jpeg/png/webp, ≤ ~4 MB) | `{items: [{category, name, description, price_sar|null, duration_min|null}], note_ar}` — review then save with `menu_bulk` (feature `menu_photo_ai`) |
| `qa` | – | `{public_id, question (≤300)}` | `{answer}` (feature `qa_assistant`; 20/hour per visitor) |
| `summary_text` | owner | `{branch_id, stats}` | `{text}` |

Daily cap per business: 200 AI calls (`ai_limit`). Without `ANTHROPIC_API_KEY` every AI action returns `ai_unavailable` and nothing else is affected.

## 11. `admin` function (platform admin JWT)

| action | request | response |
|---|---|---|
| `list` | – | `{businesses: [{id, name, slug, category, plan, effective_plan, plan_until, trial_until, is_active, is_demo, created_at, owner_email, branches[], usage: {tickets_30d, ai_calls_30d, devices}}]}` |
| `update_business` | `{business_id, changes: {plan?, plan_until?, trial_until?, is_active?}}` | `{ok}` |
| `branch_dashboard` | `{branch_id, range?}` | `Dashboard` (read-only) |

## 12. Realtime

Channel `branch:{public_id}`, event `queue_changed`, payload `{ "type": "queue_changed", "at": "<iso>" }` — no personal data. On every message refetch `public_ticket` / `public_branch` / `staff.state`. Also poll every 20 s and on `visibilitychange` as a fallback.

```js
supabase.channel(`branch:${publicId}`).on("broadcast", { event: "queue_changed" }, refetch).subscribe();
```

## 13. Web Push payloads (service worker `push` event)

```json
{ "title": "حلاق الأصيل · الملقا", "body": "حان دورك، تفضّل (رقم ٢٤)", "kind": "return_now|called|ready|stage|busy_alert|summary",
  "tag": "ticket-<id>", "url": "/s/<public_id>", "vibrate": true }
```

Open/focus `url`. The shop page returns to the active ticket stored in `localStorage`; owner pushes use `/owner`.

// Paired staff devices (header x-device-token). No user accounts.
import { requireDevice } from "../_shared/auth.ts";
import { env, rpc } from "../_shared/db.ts";
import { settle } from "../_shared/effects.ts";
import { HttpError, int, json, serve, str, uuid } from "../_shared/http.ts";
import { STAFF_LABELS } from "../_shared/i18n.ts";

serve(async (req, body) => {
  const d = await requireDevice(req);
  const dev = { p_device: d.device_id };
  const ticket = () => ({ ...dev, p_ticket: uuid(body, "ticket_id") });

  switch (body.action) {
    case "state": {
      const state = await settle(await rpc("s_state", dev));
      return json({ ...state, labels: STAFF_LABELS[d.language] ?? STAFF_LABELS.ar });
    }
    case "call_next":
      return json(await settle(await rpc("s_call_next", { ...dev, p_service: uuid(body, "service_id", false), p_provider: uuid(body, "provider_id", false) })));
    case "call_ticket":
      return json(await settle(await rpc("s_call_ticket", ticket())));
    case "serve":
      return json(await settle(await rpc("s_serve", ticket())));
    case "done":
      return json(await settle(await rpc("s_done", ticket())));
    case "push_back":
      return json(await settle(await rpc("s_push_back", ticket())));
    case "no_show":
      return json(await settle(await rpc("s_no_show", ticket())));
    case "add_walk_in":
      return json(await settle(await rpc("s_add_walk_in", {
        ...dev, p_service: uuid(body, "service_id"), p_party: int(body, "party_size", 1, 6, 1), p_provider: uuid(body, "provider_id", false),
      })));
    case "mark_ready":
      return json(await settle(await rpc("s_mark_ready", { ...dev, p_code: str(body, "receipt_code", 20) })));
    case "dropoff_create": {
      const r = await settle(await rpc("s_dropoff_create", { ...dev, p_service: uuid(body, "service_id"), p_item_label: str(body, "item_label", 60) }));
      return json({ ...r, claim_url: `${env("SITE_URL", "")}/c/${r.claim_token}` });
    }
    case "dropoff_stage":
      return json(await settle(await rpc("s_dropoff_stage", { ...ticket(), p_stage: str(body, "stage", 20) })));
    case "set_priority":
      return json(await settle(await rpc("s_set_priority", { ...ticket(), p_reason: str(body, "reason", 20) })));
    case "set_busy":
      return json(await settle(await rpc("s_set_busy", { ...dev, p_level: str(body, "level", 10, false) })));
    case "rotating_code":
      return json(await settle(await rpc("s_rotating_code", dev)));
    case "redeem_check":
      return json(await settle(await rpc("s_redeem_check", dev)));
    default:
      throw new HttpError("invalid_action");
  }
});

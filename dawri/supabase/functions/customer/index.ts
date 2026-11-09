// Anonymous customer actions. The ticket token is the only credential.
import { fingerprint } from "../_shared/auth.ts";
import { rpc } from "../_shared/db.ts";
import { settle } from "../_shared/effects.ts";
import { bool, HttpError, int, json, lang, serve, str, subscription, uuid } from "../_shared/http.ts";

serve(async (req, body) => {
  const token = () => str(body, "token", 100)!;
  switch (body.action) {
    case "ticket":
      return json(await settle(await rpc("public_ticket", { p_token: token() })));

    case "join":
      return json(await settle(await rpc("c_join", {
        p_public_id: str(body, "public_id", 16), p_service: uuid(body, "service_id"),
        p_provider: uuid(body, "provider_id", false), p_party: int(body, "party_size", 1, 6, 1),
        p_lang: lang(body), p_fingerprint: await fingerprint(req),
      })));

    case "join_receipt":
      return json(await settle(await rpc("c_join_receipt", {
        p_public_id: str(body, "public_id", 16), p_service: uuid(body, "service_id"),
        p_code: str(body, "receipt_code", 20), p_lang: lang(body), p_fingerprint: await fingerprint(req),
      })));

    case "subscribe_push": {
      const s = subscription(body);
      return json(await settle(await rpc("c_subscribe_push", { p_token: token(), p_endpoint: s.endpoint, p_p256dh: s.p256dh, p_auth: s.auth })));
    }

    case "quiet_watch": {
      const s = subscription(body);
      return json(await settle(await rpc("c_quiet_watch", {
        p_public_id: str(body, "public_id", 16), p_endpoint: s.endpoint, p_p256dh: s.p256dh, p_auth: s.auth,
        p_threshold: int(body, "threshold", 0, 10, 2), p_lang: lang(body),
      })));
    }

    case "quiet_unwatch": {
      const s = subscription(body);
      return json(await settle(await rpc("c_quiet_unwatch", { p_endpoint: s.endpoint })));
    }

    case "snooze":
      return json(await settle(await rpc("c_snooze", { p_token: token(), p_steps: int(body, "steps", 1, 2) })));

    case "leave":
      return json(await settle(await rpc("c_leave", { p_token: token() })));

    case "feedback":
      return json(await settle(await rpc("c_feedback", {
        p_token: token(), p_positive: bool(body, "positive"),
        p_reason: str(body, "reason", 20, false), p_note: str(body, "note", 280, false),
      })));

    case "set_phone":
      return json(await settle(await rpc("c_set_phone", { p_token: token(), p_phone: str(body, "phone", 20), p_consent: body.consent === true })));

    case "redeem": {
      const loyalty = body.loyalty === true;
      return json(await settle(await rpc("c_redeem", {
        p_token: token(), p_offer: loyalty ? null : uuid(body, "offer_id"), p_loyalty: loyalty, p_code: str(body, "code", 4),
      })));
    }

    case "quest_start":
      return json(await settle(await rpc("c_quest_start", { p_token: token(), p_quest: uuid(body, "quest_id") })));

    case "redeem_quest":
      return json(await settle(await rpc("c_redeem_quest", { p_token: token(), p_quest: uuid(body, "quest_id"), p_code: str(body, "code", 4) })));

    case "interest":
      return json(await settle(await rpc("c_interest", { p_token: token(), p_item: uuid(body, "item_id"), p_on: body.on !== false })));

    case "claim_dropoff":
      return json(await settle(await rpc("c_claim_dropoff", { p_claim_token: str(body, "claim_token", 100) })));

    default:
      throw new HttpError("invalid_action");
  }
});

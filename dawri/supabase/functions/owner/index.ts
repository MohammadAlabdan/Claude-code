// Shop owner actions (Supabase Auth JWT). Dashboard and devices through vetted SQL; catalog CRUD through RLS.
import { requireUser } from "../_shared/auth.ts";
import { checkFeature, dbError, listRows, pick, spec } from "../_shared/catalog.ts";
import { env, rpc, rpcOk, userClient } from "../_shared/db.ts";
import { settle } from "../_shared/effects.ts";
import { HttpError, int, json, serve, str, subscription, uuid } from "../_shared/http.ts";
import { busiestSlot, questSuggestions, quietCouponDraft, quietWindows } from "../_shared/logic.ts";

async function quiet(userId: string, branchId: string) {
  const data = await rpcOk<{ arrivals: number[][]; open: boolean[][] }>("o_quiet_data", { p_user: userId, p_branch: branchId });
  return { ...data, windows: quietWindows(data.arrivals, data.open, 2), busiest: busiestSlot(data.arrivals) };
}

export default serve(async (req, body) => {
  const user = await requireUser(req);
  const branch = () => uuid(body, "branch_id")!;
  const canManage = async (b: string) => {
    if (!(await rpc<boolean>("can_manage_branch", { p_user: user.id, p_branch: b }))) throw new HttpError("forbidden");
  };

  switch (body.action) {
    case "overview":
      return json(await rpcOk("o_overview", { p_user: user.id }));

    case "dashboard": {
      const range = ["today", "7d", "30d"].includes(String(body.range)) ? body.range : "today";
      const d = await rpcOk<Record<string, unknown>>("o_dashboard", { p_user: user.id, p_branch: branch(), p_range: range });
      const heat = d.heatmap as { arrivals: number[][]; open: boolean[][] } | null;
      return json({
        ...d,
        quiet_windows: heat ? quietWindows(heat.arrivals, heat.open, 2) : null,
        busiest: heat ? busiestSlot(heat.arrivals) : null,
      });
    }

    case "queue":
      return json(await rpcOk("o_queue", { p_user: user.id, p_branch: branch() }));

    case "set_busy":
      return json(await settle(await rpc("o_set_busy", { p_user: user.id, p_branch: branch(), p_level: str(body, "level", 10, false) })));

    case "devices":
      return json(await rpcOk("o_devices", { p_user: user.id, p_branch: branch() }));

    case "create_staff_device": {
      const r = await rpcOk<{ pairing_token: string; device_id: string }>("o_create_device", {
        p_user: user.id, p_branch: branch(), p_label: str(body, "label", 40),
        p_language: str(body, "language", 3, false) ?? "ar", p_provider: uuid(body, "provider_id", false),
      });
      return json({ ok: true, device_id: r.device_id, pairing_url: `${env("SITE_URL", "")}/staff/pair#${r.pairing_token}` });
    }

    case "revoke_device":
      return json(await rpcOk("o_revoke_device", { p_user: user.id, p_device: uuid(body, "device_id") }));

    case "settings_update":
      return json(await rpcOk("o_settings_update", { p_user: user.id, p_branch: branch(), p_settings: body.settings ?? null }));

    case "subscribe_push": {
      const s = subscription(body);
      return json(await rpcOk("o_subscribe_push", { p_user: user.id, p_endpoint: s.endpoint, p_p256dh: s.p256dh, p_auth: s.auth }));
    }

    case "quiet_hours":
      return json(await quiet(user.id, branch()));

    case "suggest_quiet_coupon": {
      const b = branch();
      const q = await quiet(user.id, b);
      if (!q.windows.length) return json({ suggestion: null });
      const locked = !(await rpc<boolean>("has_feature", { p_branch: b, p_feature: "quiet_coupon" }));
      return json({ suggestion: { ...quietCouponDraft(q.windows[0]), branch_id: b }, locked, required_plan: locked ? "full" : null });
    }

    case "ticket_events":
      return json({ events: await rpcOk("o_ticket_events", { p_user: user.id, p_branch: branch(), p_limit: int(body, "limit", 1, 500, 100) }) });

    case "quests":
      return json(await rpcOk("o_quests", { p_user: user.id, p_branch: branch() }));

    case "suggest_quests": {
      const b = branch();
      const q = await quiet(user.id, b);
      const d = await rpcOk<Record<string, unknown>>("o_dashboard", { p_user: user.id, p_branch: b, p_range: "30d" });
      const smart = await rpc<boolean>("has_feature", { p_branch: b, p_feature: "smart_quests" });
      return json({
        suggestions: questSuggestions({
          quiet: q.windows[0] ?? null,
          absent: Array.isArray(d.absent) ? d.absent.length : 0,
          providers: (d.provider_times as { provider_id: string; name: string; served: number }[] | null) ?? [],
        }).map((s) => ({ ...s, locked: s.kind !== "visits" && !smart, required_plan: s.kind !== "visits" && !smart ? "full" : null })),
      });
    }

    // ---------- catalog: list / upsert / delete / bulk insert ----------
    case "list": {
      const s = spec(body.table);
      const b = branch();
      await canManage(b);
      return json({ rows: await listRows(userClient(user.jwt, user.id), s.table, b) });
    }

    case "upsert": {
      const s = spec(body.table);
      const row = pick(body.row, s.columns);
      const id = s.key ? null : uuid(body.row as Record<string, unknown> ?? {}, "id", false);
      const db = userClient(user.jwt, user.id);
      const branchId = s.table === "branches" ? id : (row.branch_id as string | undefined) ?? null;
      if (!branchId || typeof branchId !== "string") throw new HttpError("invalid_input", { field: "branch_id" });
      await canManage(branchId);
      await checkFeature(s, branchId, row);
      if (s.table === "branches") {
        const { data, error } = await db.from("branches").update(row).eq("id", branchId).select("id").single();
        dbError(error);
        return json({ ok: true, row: data });
      }
      if (s.key) {
        const { data, error } = await db.from(s.table).upsert(row, { onConflict: s.key }).select().single();
        dbError(error);
        return json({ ok: true, row: data });
      }
      const q = id ? db.from(s.table).update(row).eq("id", id) : db.from(s.table).insert(row);
      const { data, error } = await q.select().single();
      dbError(error);
      return json({ ok: true, row: data });
    }

    case "delete": {
      const s = spec(body.table);
      if (s.noDelete) throw new HttpError("invalid_action");
      const { data, error } = await userClient(user.jwt, user.id).from(s.table).delete().eq("id", uuid(body, "id")!).select("id");
      dbError(error);
      if (!data?.length) throw new HttpError("not_found");
      return json({ ok: true });
    }

    case "menu_bulk": {
      const b = branch();
      await canManage(b);
      await checkFeature(spec("menu_items"), b, {});
      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 200) throw new HttpError("invalid_input", { field: "items" });
      const rows = body.items.map((it, i) => ({ ...pick(it, spec("menu_items").columns), branch_id: b, sort: i }));
      const db = userClient(user.jwt, user.id);
      if (body.replace === true) dbError((await db.from("menu_items").delete().eq("branch_id", b)).error);
      const { data, error } = await db.from("menu_items").insert(rows).select("id");
      dbError(error);
      return json({ ok: true, inserted: data?.length ?? 0 });
    }

    default:
      throw new HttpError("invalid_action");
  }
});

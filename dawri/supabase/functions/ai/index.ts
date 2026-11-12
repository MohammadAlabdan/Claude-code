// AI features: menu from photo (owner), Q&A assistant (anonymous), summary text (owner).
import { aiAvailable, answerQuestion, describeItems, menuFromPhoto, summaryText } from "../_shared/ai.ts";
import { requireUser } from "../_shared/auth.ts";
import { adminClient, rpc, rpcOk } from "../_shared/db.ts";
import { HttpError, json, serve, str, uuid } from "../_shared/http.ts";
import { imageMediaType } from "../_shared/logic.ts";

async function requireFeature(branchId: string, feature: string) {
  if (!(await rpc<boolean>("has_feature", { p_branch: branchId, p_feature: feature }))) {
    throw new HttpError("feature_locked", { feature, required_plan: await rpc<string>("feature_min_plan", { p_feature: feature }) });
  }
}

async function businessOf(branchId: string): Promise<string> {
  const { data } = await adminClient().from("branches").select("business_id").eq("id", branchId).single();
  if (!data) throw new HttpError("branch_not_found");
  return data.business_id;
}

export default serve(async (req, body) => {
  switch (body.action) {
    case "status":
      return json({ available: aiAvailable() });

    case "menu_from_photo": {
      const user = await requireUser(req);
      const branchId = uuid(body, "branch_id")!;
      if (!(await rpc<boolean>("can_manage_branch", { p_user: user.id, p_branch: branchId }))) throw new HttpError("forbidden");
      await requireFeature(branchId, "menu_photo_ai");
      const raw = str(body, "image_base64", 5_600_000)!.replace(/^data:image\/[a-z]+;base64,/, "");
      if (raw.length > 5_600_000) throw new HttpError("image_too_large");
      const media = imageMediaType(raw);
      if (!media) throw new HttpError("invalid_input", { field: "image_base64" });
      const items = await menuFromPhoto(await businessOf(branchId), raw, media);
      return json({ items, note_ar: "راجع الأصناف والأسعار قبل الحفظ" });
    }

    case "describe_items": {
      const user = await requireUser(req);
      const branchId = uuid(body, "branch_id")!;
      if (!(await rpc<boolean>("can_manage_branch", { p_user: user.id, p_branch: branchId }))) throw new HttpError("forbidden");
      await requireFeature(branchId, "menu_photo_ai");
      const raw = Array.isArray(body.items) ? body.items as Record<string, unknown>[] : [];
      if (!raw.length || raw.length > 20) throw new HttpError("invalid_input", { field: "items" });
      const items = raw.map((it) => {
        const text = (k: string, max: number) => (typeof it[k] === "string" && (it[k] as string).trim() ? (it[k] as string).trim().slice(0, max) : null);
        const n = (k: string, lo: number, hi: number) => (typeof it[k] === "number" && (it[k] as number) >= lo && (it[k] as number) <= hi ? it[k] as number : null);
        const name = text("name", 80);
        if (!name) throw new HttpError("invalid_input", { field: "name" });
        return { name, category: text("category", 40), price_sar: n("price_sar", 0, 100000), duration_min: n("duration_min", 1, 600), note: text("note", 200) };
      });
      const { data: br } = await adminClient().from("branches").select("business_id, name, businesses(name, category)").eq("id", branchId).single();
      if (!br) throw new HttpError("branch_not_found");
      const bz = (br as { businesses?: { name?: string; category?: string } }).businesses;
      return json({ descriptions: await describeItems(br.business_id, { name: bz?.name ?? br.name, category: bz?.category ?? null }, items) });
    }

    case "qa": {
      const publicId = str(body, "public_id", 16)!;
      const question = str(body, "question", 300)!.trim();
      const data = await rpcOk<Record<string, unknown>>("public_branch", { p_public_id: publicId });
      const { data: br } = await adminClient().from("branches").select("id, business_id").eq("public_id", publicId.toLowerCase()).single();
      if (!br) throw new HttpError("branch_not_found");
      await requireFeature(br.id, "qa_assistant");
      if (!(await rpc<boolean>("hit_rate_limit", { p_key: `qa:${br.id}:${req.headers.get("x-forwarded-for") ?? ""}`, p_max: 20 }))) {
        throw new HttpError("rate_limited");
      }
      const { best_time: _b, server_time: _s, ...publicData } = data;
      return json({ answer: await answerQuestion(br.business_id, publicData, question) });
    }

    case "summary_text": {
      const user = await requireUser(req);
      const branchId = uuid(body, "branch_id")!;
      if (!(await rpc<boolean>("can_manage_branch", { p_user: user.id, p_branch: branchId }))) throw new HttpError("forbidden");
      await requireFeature(branchId, "evening_summary");
      return json({ text: await summaryText(await businessOf(branchId), body.stats ?? {}) });
    }

    default:
      throw new HttpError("invalid_action");
  }
});

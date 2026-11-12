import { errorBody, errorStatus } from "./errors.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

export function fail(code: string, extra: Record<string, unknown> = {}): Response {
  return json(errorBody(code, extra), errorStatus(code));
}

export class HttpError extends Error {
  constructor(public code: string, public extra: Record<string, unknown> = {}) {
    super(code);
  }
}

export type Body = Record<string, unknown> & { action?: string };

/** Standard POST handler: CORS, JSON parsing, error mapping. */
export function serve(handler: (req: Request, body: Body) => Promise<Response>): (req: Request) => Promise<Response> {
  const h = async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return fail("invalid_action");
    let body: Body = {};
    const text = await req.text();
    if (text.length > 6_000_000) return fail("image_too_large");
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        return fail("invalid_json");
      }
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) return fail("invalid_json");
    try {
      return await handler(req, body);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.code, e.extra);
      console.error(e);
      return fail("server_error");
    }
  };
  // Supabase Edge Runtime serves it; on Netlify the function entry exports it instead.
  if (typeof Deno.serve === "function") Deno.serve(h);
  return h;
}

// ---------- input validation ----------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function str(body: Body, key: string, max = 200, required = true): string | null {
  const v = body[key];
  if (v === undefined || v === null || v === "") {
    if (required) throw new HttpError("invalid_input", { field: key });
    return null;
  }
  if (typeof v !== "string" || v.length > max) throw new HttpError("invalid_input", { field: key });
  return v;
}

export function uuid(body: Body, key: string, required = true): string | null {
  const v = str(body, key, 36, required);
  if (v !== null && !UUID.test(v)) throw new HttpError("invalid_input", { field: key });
  return v;
}

export function int(body: Body, key: string, min: number, max: number, fallback?: number): number {
  const v = body[key] ?? fallback;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new HttpError("invalid_input", { field: key });
  }
  return v;
}

export function bool(body: Body, key: string, fallback?: boolean): boolean {
  const v = body[key] ?? fallback;
  if (typeof v !== "boolean") throw new HttpError("invalid_input", { field: key });
  return v;
}

export function lang(body: Body): "ar" | "en" {
  return body.lang === "en" ? "en" : "ar";
}

export function subscription(body: Body): { endpoint: string; p256dh: string; auth: string } {
  const s = body.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
  if (!s || typeof s.endpoint !== "string" || typeof s.keys?.p256dh !== "string" || typeof s.keys?.auth !== "string") {
    throw new HttpError("invalid_subscription");
  }
  return { endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth };
}

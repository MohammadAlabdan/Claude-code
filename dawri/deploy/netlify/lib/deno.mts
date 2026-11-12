// The shared function code was written for Deno (Supabase Edge Runtime). On Netlify (Node) it only needs Deno.env.
// Imported first by every entry so it runs before the shared modules evaluate.
const g = globalThis as unknown as { Deno?: { env: { get(k: string): string | undefined } } };
g.Deno ??= { env: { get: (k: string) => process.env[k] } };
process.env.DAWRI_BACKEND ??= "netlify";
export {};

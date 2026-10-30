// Prints a VAPID key pair for Web Push.  Run:  deno run scripts/gen-vapid.ts
// Public key → web/config.js (VAPID_PUBLIC_KEY) and function secret VAPID_PUBLIC_KEY.
// Private key → function secret VAPID_PRIVATE_KEY only. Never put it in the frontend.
const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
const pub = await crypto.subtle.exportKey("raw", pair.publicKey);
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);

console.log(`VAPID_PUBLIC_KEY=${b64url(pub)}`);
console.log(`VAPID_PRIVATE_KEY=${jwk.d}`);

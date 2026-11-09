// Web Push on the frontend: permission only after a tap, then subscribe with the VAPID key.
const cfg = () => window.DAWRI_CONFIG ?? {};

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** iPhone needs the page added to the home screen before push works. */
export const needsInstallForPush = () => isIOS() && !isStandalone();

function urlBase64ToUint8Array(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Returns a PushSubscription JSON, or throws Error("denied" | "unsupported"). */
export async function subscribePush() {
  if (!pushSupported()) throw new Error("unsupported");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("denied");
  if (cfg().DEMO_MODE || !cfg().VAPID_PUBLIC_KEY || cfg().VAPID_PUBLIC_KEY.startsWith("YOUR")) {
    return { endpoint: "https://demo.invalid/push/" + Math.random().toString(36).slice(2), keys: { p256dh: "demo-key-000000000000000000", auth: "demo-auth-0" } };
  }
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(cfg().VAPID_PUBLIC_KEY) });
  return sub.toJSON();
}

/** Demo mode has no push server: show the notification locally through the service worker. */
export async function localNotify(title, body, url) {
  try {
    if (Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification(title, { body, icon: "assets/icons/icon-192.png", badge: "assets/icons/icon-192.png", data: { url: new URL(url, document.baseURI).href }, tag: url, vibrate: [200, 100, 200] });
  } catch { /* not available */ }
}

/** Plays a short chime; only works after a user gesture unlocked audio. */
let audioCtx;
export function unlockAudio() {
  try { audioCtx ??= new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === "suspended") audioCtx.resume(); } catch { /* no audio */ }
}
export function chime() {
  if (!audioCtx || audioCtx.state !== "running") return;
  const now = audioCtx.currentTime;
  [660, 880, 990].forEach((f, i) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = f; o.type = "sine";
    g.gain.setValueAtTime(0.0001, now + i * 0.18); g.gain.exponentialRampToValueAtTime(0.25, now + i * 0.18 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.35);
    o.connect(g).connect(audioCtx.destination); o.start(now + i * 0.18); o.stop(now + i * 0.18 + 0.4);
  });
}

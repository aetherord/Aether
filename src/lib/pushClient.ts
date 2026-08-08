/**
 * Client-side Web Push setup. Registers the service worker and, when the
 * server has VAPID keys configured (and the user has granted notification
 * permission), subscribes the browser so messages arrive even with the chat
 * window closed.
 */

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64norm = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64norm);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Registers the SW + subscribes for push. Safe to call repeatedly. */
export async function setupPushSubscription(): Promise<boolean> {
  try {
    if (typeof window === "undefined") return false;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
    if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
      return false;
    }

    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    const existing = await reg.pushManager.getSubscription();
    if (existing) return true; // already subscribed

    const res = await fetch("/api/push/config");
    if (!res.ok) return false;
    const data = (await res.json()) as { enabled?: boolean; publicKey?: string | null };
    if (!data.enabled || !data.publicKey) return false; // VAPID not configured

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.publicKey),
    });
    const subJson = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: subJson.endpoint ?? "",
        p256dh: subJson.keys?.p256dh ?? "",
        auth: subJson.keys?.auth ?? "",
      }),
    });
    return true;
  } catch {
    return false;
  }
}

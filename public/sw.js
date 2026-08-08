/* Aether service worker — shows push notifications even when the chat tab is
 * closed, and opens the chat when a notification is clicked. */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* non-JSON payloads are ignored */
  }
  const title = data.title || "Aether";
  const options = {
    body: data.body || "",
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: data.tag || "aether",
    data: { url: data.url || "/chat" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/chat";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          if (new URL(client.url).origin === self.location.origin) {
            if ("focus" in client) {
              client.navigate(target);
              return client.focus();
            }
          }
        }
        return self.clients.openWindow(target);
      })
  );
});

/* global self, URL */

const FALLBACK_NOTIFICATION = {
  title: "Four in a Row",
  body: "You have a new game update.",
  tag: "four-game-update",
  url: "/dashboard",
};

self.addEventListener("push", (event) => {
  let notification = FALLBACK_NOTIFICATION;
  try {
    const payload = event.data?.json();
    if (payload && typeof payload === "object") {
      notification = { ...FALLBACK_NOTIFICATION, ...payload };
    }
  } catch {
    // A visible fallback notification is required even if a payload is malformed.
  }

  event.waitUntil(
    self.registration.showNotification(notification.title, {
      body: notification.body,
      tag: notification.tag,
      icon: "/icons/app-icon-192.png",
      badge: "/icons/notification-badge-96.png",
      data: { url: notification.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requestedUrl = new URL(event.notification.data?.url ?? "/dashboard", self.location.origin);
  const targetUrl =
    requestedUrl.origin === self.location.origin
      ? requestedUrl.href
      : new URL("/dashboard", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const appWindow = clients.find(
        (client) => new URL(client.url).origin === self.location.origin,
      );
      if (appWindow) {
        await appWindow.navigate(targetUrl);
        return appWindow.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});

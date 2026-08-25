import type { PushConfig, PushSubscriptionInput } from "@four/contracts";

import { api } from "./api";

export type WebPushStatus =
  | "checking"
  | "enabled"
  | "default"
  | "denied"
  | "install-required"
  | "unsupported"
  | "unavailable";

function notificationApi(): typeof Notification | null {
  return typeof Notification === "undefined" ? null : Notification;
}

function isIosOrIpados() {
  const userAgent = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone() {
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
  return (
    standaloneNavigator.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true
  );
}

function hasWebPushApis() {
  return (
    notificationApi() !== null && "serviceWorker" in navigator && typeof PushManager !== "undefined"
  );
}

function decodeApplicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration?.pushManager.getSubscription() ?? null;
}

export async function registerNotificationServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export async function getWebPushStatus(config: PushConfig): Promise<WebPushStatus> {
  if (isIosOrIpados() && !isStandalone()) return "install-required";
  if (!hasWebPushApis()) return "unsupported";
  if (!config.enabled || !config.publicKey) return "unavailable";

  const permission = notificationApi()!.permission;
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "default";
  return (await currentSubscription()) ? "enabled" : "default";
}

export async function enableWebPush(config: PushConfig): Promise<WebPushStatus> {
  if (isIosOrIpados() && !isStandalone()) return "install-required";
  if (!hasWebPushApis()) return "unsupported";
  if (!config.enabled || !config.publicKey) return "unavailable";

  const notifications = notificationApi()!;
  const permission =
    notifications.permission === "default"
      ? await notifications.requestPermission()
      : notifications.permission;
  if (permission !== "granted") return permission;

  const registration = await registerNotificationServiceWorker();
  if (!registration || !config.publicKey) return "unsupported";
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeApplicationServerKey(config.publicKey),
    }));
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error("The browser returned an incomplete push subscription.");
  }

  const input: PushSubscriptionInput = {
    endpoint: json.endpoint,
    expirationTime: json.expirationTime,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
  };
  await api<{ subscribed: true }>("/api/push/subscriptions", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return "enabled";
}

export async function disableWebPush(config?: PushConfig): Promise<WebPushStatus> {
  if (!hasWebPushApis()) return "unsupported";
  const subscription = await currentSubscription();
  if (subscription) {
    try {
      await api<{ subscribed: false }>("/api/push/subscriptions", {
        method: "DELETE",
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
    } finally {
      await subscription.unsubscribe();
    }
  }
  if (config) return getWebPushStatus(config);
  return "default";
}

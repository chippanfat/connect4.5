import type { PushConfig } from "@four/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { enableWebPush, getWebPushStatus } from "./push-notifications";

const config: PushConfig = {
  enabled: true,
  publicKey:
    "BEl6vCs1QzKxwS6bCrx4j7BOIGOKN7TzWboHMWzu-yFxMxcVQHNp_HMOAiUbIWIzKFNzzt64Jqz4R1n8DjENbyM",
};

class FakePushManager {}

class FakeNotification {
  static permission: NotificationPermission = "default";
  static requestPermission = vi.fn(async () => {
    FakeNotification.permission = "granted";
    return "granted" as const;
  });
}

function stubWindow(standalone = false) {
  vi.stubGlobal("window", {
    matchMedia: vi.fn(() => ({ matches: standalone })),
  });
}

describe("web push notifications", () => {
  afterEach(() => {
    FakeNotification.permission = "default";
    FakeNotification.requestPermission.mockClear();
    vi.unstubAllGlobals();
  });

  it("explains that iOS notifications require the Home Screen app", async () => {
    stubWindow(false);
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      platform: "iPhone",
      maxTouchPoints: 5,
    });

    expect(await getWebPushStatus(config)).toBe("install-required");
  });

  it("requests permission, subscribes with the VAPID key, and saves the subscription", async () => {
    const subscription = {
      toJSON: () => ({
        endpoint: "https://push.example.test/subscription/123",
        expirationTime: null,
        keys: { p256dh: "browser-public-key", auth: "browser-auth-secret" },
      }),
    };
    const registration = {
      pushManager: {
        getSubscription: vi.fn(async () => null),
        subscribe: vi.fn(async () => subscription),
      },
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, data: { subscribed: true } }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );
    stubWindow(false);
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 Chrome/140",
      platform: "Linux armv8l",
      maxTouchPoints: 1,
      serviceWorker: {
        getRegistration: vi.fn(async () => registration),
        register: vi.fn(async () => registration),
      },
    });
    vi.stubGlobal("Notification", FakeNotification);
    vi.stubGlobal("PushManager", FakePushManager);
    vi.stubGlobal("fetch", fetchMock);

    expect(await enableWebPush(config)).toBe("enabled");
    expect(FakeNotification.requestPermission).toHaveBeenCalledOnce();
    expect(registration.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/push/subscriptions",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });
});

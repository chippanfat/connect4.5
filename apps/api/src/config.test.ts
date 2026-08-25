import { describe, expect, it } from "vitest";

import { loadConfig } from "./config";

describe("web push configuration", () => {
  it("enables Web Push when a complete VAPID key pair is configured", () => {
    const config = loadConfig({
      VAPID_PUBLIC_KEY: "public-key",
      VAPID_PRIVATE_KEY: "private-key",
      VAPID_SUBJECT: "mailto:push@example.test",
    });

    expect(config.push).toEqual({
      enabled: true,
      publicKey: "public-key",
      privateKey: "private-key",
      subject: "mailto:push@example.test",
    });
  });

  it("rejects a partial VAPID key configuration", () => {
    expect(() => loadConfig({ VAPID_PUBLIC_KEY: "public-key" })).toThrow(
      "VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be configured together.",
    );
  });
});

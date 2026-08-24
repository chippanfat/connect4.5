import type { GameInvitationNotificationEvent } from "@four/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  showGameInvitationNotification,
} from "./browser-notifications";

const invitation: GameInvitationNotificationEvent = {
  gameId: "3be176bd-837b-4600-b115-808b66354792",
  host: { userId: "host-id", username: "yellowchamp" },
  turnSeconds: 60,
};

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn(async () => FakeNotification.permission);
  static instances: FakeNotification[] = [];

  onclick: (() => void) | null = null;
  close = vi.fn();

  constructor(
    readonly title: string,
    readonly options?: NotificationOptions,
  ) {
    FakeNotification.instances.push(this);
  }
}

describe("browser game invitation notifications", () => {
  afterEach(() => {
    FakeNotification.instances = [];
    FakeNotification.permission = "granted";
    FakeNotification.requestPermission.mockClear();
    vi.unstubAllGlobals();
  });

  it("does nothing unless the user has granted browser permission", () => {
    FakeNotification.permission = "default";
    vi.stubGlobal("Notification", FakeNotification);

    expect(showGameInvitationNotification(invitation, vi.fn())).toBeNull();
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it("shows the sender and opens the invitation when clicked", () => {
    vi.stubGlobal("Notification", FakeNotification);
    const onClick = vi.fn();

    const result = showGameInvitationNotification(invitation, onClick);
    const shown = FakeNotification.instances[0];

    expect(result).toBe(shown);
    expect(shown?.title).toBe("yellowchamp invited you to play");
    expect(shown?.options).toMatchObject({
      body: "Open Four in a Row to answer their 60-second game invitation.",
      tag: `game-invitation:${invitation.gameId}`,
    });

    shown?.onclick?.();
    expect(shown?.close).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("reports support and requests permission through the browser API", async () => {
    FakeNotification.permission = "default";
    vi.stubGlobal("Notification", FakeNotification);

    expect(getBrowserNotificationPermission()).toBe("default");
    expect(await requestBrowserNotificationPermission()).toBe("default");
    expect(FakeNotification.requestPermission).toHaveBeenCalledOnce();
  });
});

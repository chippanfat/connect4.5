import type { GameInvitationNotificationEvent } from "@four/contracts";

export type BrowserNotificationPermission = NotificationPermission | "unsupported";

function notificationApi(): typeof Notification | null {
  return typeof Notification === "undefined" ? null : Notification;
}

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  return notificationApi()?.permission ?? "unsupported";
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  const api = notificationApi();
  if (!api) return "unsupported";
  try {
    return await api.requestPermission();
  } catch {
    return api.permission;
  }
}

export function showGameInvitationNotification(
  invitation: GameInvitationNotificationEvent,
  onClick: () => void,
): Notification | null {
  const api = notificationApi();
  if (!api || api.permission !== "granted") return null;

  let notification: Notification;
  try {
    notification = new api(`${invitation.host.username} invited you to play`, {
      body: `Open Four in a Row to answer their ${invitation.turnSeconds}-second game invitation.`,
      tag: `game-invitation:${invitation.gameId}`,
    });
  } catch {
    return null;
  }
  notification.onclick = () => {
    notification.close();
    onClick();
  };
  return notification;
}

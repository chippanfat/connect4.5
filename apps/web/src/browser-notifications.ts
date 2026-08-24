import type {
  GameInvitationNotificationEvent,
  RematchRequestedNotificationEvent,
} from "@four/contracts";

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

function showBrowserNotification(
  title: string,
  options: NotificationOptions,
  onClick: () => void,
): Notification | null {
  const api = notificationApi();
  if (!api || api.permission !== "granted") return null;

  let notification: Notification;
  try {
    notification = new api(title, options);
  } catch {
    return null;
  }
  notification.onclick = () => {
    notification.close();
    onClick();
  };
  return notification;
}

export function showGameInvitationNotification(
  invitation: GameInvitationNotificationEvent,
  onClick: () => void,
): Notification | null {
  return showBrowserNotification(
    `${invitation.host.username} invited you to play`,
    {
      body: `Open Four in a Row to answer their ${invitation.turnSeconds}-second game invitation.`,
      tag: `game-invitation:${invitation.gameId}`,
    },
    onClick,
  );
}

export function showRematchRequestedNotification(
  request: RematchRequestedNotificationEvent,
  onClick: () => void,
): Notification | null {
  return showBrowserNotification(
    `${request.requestedBy.username} requested a rematch`,
    {
      body: "Open Four in a Row to play them again.",
      tag: `rematch-request:${request.gameId}`,
    },
    onClick,
  );
}

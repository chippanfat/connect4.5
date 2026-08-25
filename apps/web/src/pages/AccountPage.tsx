import type { PushConfig } from "@four/contracts";
import { BellRing } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { api } from "../api";
import { authClient } from "../auth-client";
import {
  disableWebPush,
  enableWebPush,
  getWebPushStatus,
  type WebPushStatus,
} from "../push-notifications";
import { Alert } from "../components";

function notificationDescription(status: WebPushStatus) {
  switch (status) {
    case "enabled":
      return "Enabled on this device. You’ll be notified about game invitations and rematch requests.";
    case "denied":
      return "Blocked by your device. Allow notifications for Four in your device settings.";
    case "install-required":
      return "On iPhone or iPad, open this site in Safari, tap Share, choose Add to Home Screen, then open Four from your Home Screen and return here.";
    case "unsupported":
      return "Web notifications are not supported by this browser or device.";
    case "unavailable":
      return "Web notifications are temporarily unavailable.";
    case "checking":
      return "Checking notification support on this device…";
    default:
      return "Get alerts for new game invitations and rematch requests, even when Four is closed.";
  }
}

export function AccountPage() {
  const { data: session } = authClient.useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushConfig, setPushConfig] = useState<PushConfig | null>(null);
  const [notificationStatus, setNotificationStatus] = useState<WebPushStatus>("checking");
  const [notificationError, setNotificationError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const refreshStatus = async () => {
      try {
        const config = await api<PushConfig>("/api/push/config");
        const status = await getWebPushStatus(config);
        if (active) {
          setPushConfig(config);
          setNotificationStatus(status);
        }
      } catch {
        if (active) setNotificationStatus("unavailable");
      }
    };
    const handleFocus = () => void refreshStatus();
    void refreshStatus();
    window.addEventListener("focus", handleFocus);
    return () => {
      active = false;
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  async function enableBrowserNotifications() {
    if (!pushConfig) return;
    setNotificationError(null);
    try {
      setNotificationStatus(await enableWebPush(pushConfig));
    } catch {
      setNotificationError("Notifications could not be enabled. Please try again.");
    }
  }

  async function disableBrowserNotifications() {
    if (!pushConfig) return;
    setNotificationError(null);
    try {
      setNotificationStatus(await disableWebPush(pushConfig));
    } catch {
      setNotificationError("Notifications could not be fully disabled. Please try again.");
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const result = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    if (result.error) setError(result.error.message ?? "Unable to change the password.");
    else {
      setMessage("Password updated. Your other sessions were signed out.");
      setCurrentPassword("");
      setNewPassword("");
    }
  }
  return (
    <main className="account-page content-width">
      <header className="page-heading">
        <p className="eyebrow">Account</p>
        <h1>Your player profile</h1>
        <p>Your email stays private. Other players only see your username.</p>
      </header>
      <div className="account-grid">
        <section className="settings-card">
          <h2>Profile</h2>
          <dl>
            <div>
              <dt>Username</dt>
              <dd>{session?.user.displayUsername ?? session?.user.username}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{session?.user.email}</dd>
            </div>
            <div>
              <dt>Email status</dt>
              <dd>{session?.user.emailVerified ? "Verified" : "Needs verification"}</dd>
            </div>
          </dl>
        </section>
        <section className="settings-card">
          <h2>Change password</h2>
          <form className="form-stack" onSubmit={(event) => void changePassword(event)}>
            {error && <Alert>{error}</Alert>}
            {message && <Alert tone="success">{message}</Alert>}
            <label>
              Current password
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </label>
            <label>
              New password
              <input
                type="password"
                minLength={10}
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
              />
            </label>
            <button className="button button--soft">Update password</button>
          </form>
        </section>
        <section className="settings-card settings-card--wide">
          <div className="notification-setting">
            <span className="notification-setting__icon" aria-hidden="true">
              <BellRing />
            </span>
            <div>
              <h2>App notifications</h2>
              <p>{notificationDescription(notificationStatus)}</p>
              {notificationError && (
                <p className="notification-setting__error" role="alert">
                  {notificationError}
                </p>
              )}
            </div>
            {notificationStatus === "default" && (
              <button
                className="button button--soft"
                type="button"
                onClick={() => void enableBrowserNotifications()}
              >
                Enable notifications
              </button>
            )}
            {notificationStatus === "enabled" && (
              <button
                className="button button--soft"
                type="button"
                onClick={() => void disableBrowserNotifications()}
              >
                Disable on this device
              </button>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

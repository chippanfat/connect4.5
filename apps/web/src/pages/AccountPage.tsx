import { BellRing } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { authClient } from "../auth-client";
import {
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  type BrowserNotificationPermission,
} from "../browser-notifications";
import { Alert } from "../components";

export function AccountPage() {
  const { data: session } = authClient.useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] =
    useState<BrowserNotificationPermission>(getBrowserNotificationPermission);

  useEffect(() => {
    const refreshPermission = () => setNotificationPermission(getBrowserNotificationPermission());
    window.addEventListener("focus", refreshPermission);
    return () => window.removeEventListener("focus", refreshPermission);
  }, []);

  async function enableBrowserNotifications() {
    setNotificationPermission(await requestBrowserNotificationPermission());
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
              <h2>Browser notifications</h2>
              <p>
                {notificationPermission === "granted"
                  ? "Enabled. You’ll be notified when a friend invites you to a new game."
                  : notificationPermission === "denied"
                    ? "Blocked by your browser. Allow notifications for this site in your browser settings."
                    : notificationPermission === "unsupported"
                      ? "Notifications are not supported by this browser."
                      : "Get an alert when a friend invites you to a new game."}
              </p>
            </div>
            {notificationPermission === "default" && (
              <button
                className="button button--soft"
                type="button"
                onClick={() => void enableBrowserNotifications()}
              >
                Enable notifications
              </button>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

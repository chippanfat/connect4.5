import { CircleUserRound, Gamepad2, LogOut } from "lucide-react";
import { Link, NavLink, useNavigate } from "react-router-dom";

import { authClient } from "./auth-client";

export function Logo() {
  return (
    <Link className="brand" to="/" aria-label="Four in a Row home">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span>Four in a Row</span>
    </Link>
  );
}

export function PageLoader({ label = "Loading" }: { label?: string }) {
  return (
    <main className="center-page" aria-live="polite">
      <span className="loader" aria-hidden="true" />
      <p>{label}…</p>
    </main>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  async function signOut() {
    await authClient.signOut();
    navigate("/");
  }
  return (
    <div className="app-shell">
      <header className="app-header">
        <Logo />
        <nav className="app-nav" aria-label="Account navigation">
          <NavLink to="/dashboard">
            <Gamepad2 size={18} aria-hidden="true" />
            <span>Games</span>
          </NavLink>
          <NavLink to="/account">
            <CircleUserRound size={18} aria-hidden="true" />
            <span>{session?.user.displayUsername ?? session?.user.username ?? "Account"}</span>
          </NavLink>
          <button className="nav-button" type="button" onClick={() => void signOut()}>
            <LogOut size={18} aria-hidden="true" />
            <span className="desktop-only">Sign out</span>
          </button>
        </nav>
      </header>
      {children}
    </div>
  );
}

export function Alert({
  children,
  tone = "error",
}: {
  children: React.ReactNode;
  tone?: "error" | "info" | "success";
}) {
  return (
    <div className={`alert alert--${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

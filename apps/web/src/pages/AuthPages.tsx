import { ArrowLeft, CheckCircle2, Mail } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { authClient } from "../auth-client";
import { Alert, Logo } from "../components";

function safeReturnTo(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="auth-page">
      <Link className="back-link" to="/">
        <ArrowLeft size={17} /> Home
      </Link>
      <section className="auth-card">
        <Logo />
        <div className="auth-heading">
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {children}
      </section>
    </main>
  );
}

export function SignInPage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const [identity, setIdentity] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = identity.includes("@")
      ? await authClient.signIn.email({ email: identity, password })
      : await authClient.signIn.username({ username: identity, password });
    setBusy(false);
    if (result.error) setError(result.error.message ?? "Unable to sign in.");
    else navigate(safeReturnTo(search.get("returnTo")));
  }

  return (
    <AuthShell title="Welcome back" subtitle="Pick up your games from any screen.">
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        {error && <Alert>{error}</Alert>}
        <label>
          Username or email
          <input
            autoComplete="username"
            value={identity}
            onChange={(event) => setIdentity(event.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <div className="form-row form-row--between">
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        <button className="button button--primary button--block" disabled={busy} type="submit">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="auth-footer">
        New here? <Link to="/sign-up">Create an account</Link>
      </p>
    </AuthShell>
  );
}

export function SignUpPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await authClient.signUp.email({
      email,
      password,
      name: username,
      username,
      displayUsername: username,
      callbackURL: `${window.location.origin}/dashboard`,
    });
    setBusy(false);
    if (result.error) setError(result.error.message ?? "Unable to create your account.");
    else navigate(`/verify-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <AuthShell title="Make your move" subtitle="Create an account to host and join private games.">
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        {error && <Alert>{error}</Alert>}
        <label>
          Username
          <input
            autoComplete="username"
            minLength={3}
            maxLength={20}
            pattern="[A-Za-z0-9_]+"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
          <small>3–20 letters, numbers, or underscores.</small>
        </label>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <small>Use at least 10 characters.</small>
        </label>
        <button className="button button--primary button--block" disabled={busy} type="submit">
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="auth-footer">
        Already playing? <Link to="/sign-in">Sign in</Link>
      </p>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    setSent(true);
  }
  return (
    <AuthShell title="Reset your password" subtitle="We’ll email you a secure reset link.">
      {sent ? (
        <Alert tone="success">
          If an account exists for that address, the reset email is on its way.
        </Alert>
      ) : (
        <form className="form-stack" onSubmit={(event) => void submit(event)}>
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <button className="button button--primary button--block" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
      <p className="auth-footer">
        <Link to="/sign-in">Back to sign in</Link>
      </p>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const token = search.get("token");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token) return setError("This reset link is incomplete or expired.");
    const result = await authClient.resetPassword({ token, newPassword: password });
    if (result.error) setError(result.error.message ?? "Unable to reset the password.");
    else navigate("/sign-in");
  }
  return (
    <AuthShell title="Choose a new password" subtitle="Your other sessions will be signed out.">
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        {error && <Alert>{error}</Alert>}
        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <button className="button button--primary button--block">Save new password</button>
      </form>
    </AuthShell>
  );
}

export function VerifyEmailPage() {
  const [search] = useSearchParams();
  const email = useMemo(() => search.get("email"), [search]);
  const error = search.get("error");
  return (
    <AuthShell title="Check your inbox" subtitle="One quick step, then it’s game time.">
      {error ? (
        <Alert>This verification link is invalid or expired. Sign in to request another.</Alert>
      ) : (
        <div className="verify-message">
          <span className="mail-icon">
            <Mail />
          </span>
          <p>
            We sent a one-hour verification link
            {email ? (
              <>
                {" "}
                to <strong>{email}</strong>
              </>
            ) : (
              " to your email"
            )}
            .
          </p>
          <p className="muted">Open it on this device or any other browser.</p>
          <CheckCircle2 className="verify-check" />
        </div>
      )}
      <p className="auth-footer">
        <Link to="/sign-in">Continue to sign in</Link>
      </p>
    </AuthShell>
  );
}

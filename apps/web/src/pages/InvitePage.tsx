import type { GameSnapshot, InvitePreview } from "@four/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Clock3, LockKeyhole, UserRound } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api } from "../api";
import { authClient } from "../auth-client";
import { Alert, Logo, PageLoader } from "../components";

export function InvitePage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const preview = useQuery({
    queryKey: ["invite", code],
    queryFn: () => api<InvitePreview>(`/api/invites/${code}`),
    retry: false,
  });
  const join = useMutation({
    mutationFn: () => api<GameSnapshot>(`/api/invites/${code}/join`, { method: "POST" }),
    onSuccess: (game) => navigate(`/game/${game.id}`),
  });
  if (preview.isLoading || sessionPending) return <PageLoader label="Opening invitation" />;

  return (
    <main className="invite-page">
      <header className="preview-nav">
        <Logo />
        {session && (
          <Link className="button button--ghost" to="/dashboard">
            Your games
          </Link>
        )}
      </header>
      <section className="invite-hero">
        <div className="invite-board" aria-hidden="true">
          <span className="preview-slot preview-slot--red" />
          <span className="preview-slot preview-slot--yellow" />
          <span className="preview-slot" />
          <span className="preview-slot preview-slot--red" />
        </div>
        {preview.error || !preview.data ? (
          <div className="invite-copy">
            <p className="eyebrow">Invitation unavailable</p>
            <h1>This table is closed.</h1>
            <p>The link may be incorrect, expired, or already filled.</p>
            <Link className="button button--primary" to="/">
              Return home
            </Link>
          </div>
        ) : (
          <div className="invite-copy">
            <p className="eyebrow">Private game invitation</p>
            <h1>{preview.data.hostUsername} is waiting for you.</h1>
            <p>
              Join their private Four in a Row table. Your disc color and first player are chosen
              when the game begins.
            </p>
            <div className="invite-facts">
              <span>
                <UserRound />
                Two players
              </span>
              <span>
                <Clock3 />
                {preview.data.turnSeconds}s turns
              </span>
              <span>
                <LockKeyhole />
                Private table
              </span>
            </div>
            {join.error && <Alert>{join.error.message}</Alert>}
            {preview.data.status === "expired" ? (
              <Alert>This invitation has expired.</Alert>
            ) : preview.data.status !== "waiting" ? (
              <Alert>This game already has two players.</Alert>
            ) : session ? (
              <button
                className="button button--primary"
                disabled={join.isPending}
                onClick={() => join.mutate()}
              >
                {join.isPending ? "Taking your seat…" : "Join the game"}
              </button>
            ) : (
              <Link
                className="button button--primary"
                to={`/sign-in?returnTo=${encodeURIComponent(`/join/${code}`)}`}
              >
                Sign in to join
              </Link>
            )}
            <small>
              Opening this page does not claim the seat. You join only when you press the button.
            </small>
          </div>
        )}
      </section>
    </main>
  );
}

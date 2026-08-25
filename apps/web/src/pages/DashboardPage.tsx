import type {
  CreateGameResponse,
  GameListItem,
  GameListResponse,
  GameSnapshot,
  SocialSnapshot,
  TurnSeconds,
} from "@four/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BellRing,
  Check,
  Clock3,
  Copy,
  Gamepad2,
  Plus,
  Trophy,
  UsersRound,
  X,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "../api";
import { authClient } from "../auth-client";
import { Alert } from "../components";
import { GameResultRow } from "../head-to-head";
import { useSocial } from "../social-context";

export function DashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const { social } = useSocial();
  const [turnSeconds, setTurnSeconds] = useState<TurnSeconds>(60);
  const [invitationType, setInvitationType] = useState<"link" | "friend">("link");
  const [friendUserId, setFriendUserId] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const active = useQuery({
    queryKey: ["games", "active"],
    queryFn: () => api<GameListResponse>("/api/games?status=active"),
  });
  const history = useQuery({
    queryKey: ["games", "completed"],
    queryFn: () => api<GameListResponse>("/api/games?status=completed"),
  });
  const create = useMutation({
    mutationFn: () =>
      api<CreateGameResponse>("/api/games", {
        method: "POST",
        body: JSON.stringify({
          turnSeconds,
          invitation:
            invitationType === "friend"
              ? { type: "friend", userId: friendUserId }
              : { type: "link" },
        }),
      }),
    onSuccess: async ({ game }) => {
      await queryClient.invalidateQueries({ queryKey: ["games"] });
      navigate(`/game/${game.id}`);
    },
  });
  const cancel = useMutation({
    mutationFn: (gameId: string) => api(`/api/games/${gameId}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["games"] });
    },
  });
  const friendRequestAction = useMutation({
    mutationFn: ({ requestId, action }: { requestId: string; action: "accept" | "decline" }) =>
      api<SocialSnapshot>(`/api/friend-requests/${requestId}/${action}`, { method: "POST" }),
    onSuccess: (state) => queryClient.setQueryData(["social"], state),
  });
  const gameInvitationAction = useMutation<
    GameSnapshot | { gameId: string; status: string },
    Error,
    { gameId: string; action: "accept" | "decline" }
  >({
    mutationFn: ({ gameId, action }: { gameId: string; action: "accept" | "decline" }) =>
      action === "accept"
        ? api<GameSnapshot>(`/api/game-invitations/${gameId}/accept`, { method: "POST" })
        : api<{ gameId: string; status: string }>(`/api/game-invitations/${gameId}/decline`, {
            method: "POST",
          }),
    onSuccess: async (data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["social"] }),
        queryClient.invalidateQueries({ queryKey: ["games"] }),
      ]);
      if (variables.action === "accept" && "id" in data) navigate(`/game/${data.id}`);
    },
  });
  const username = session?.user.displayUsername ?? session?.user.username ?? "Player";
  const userId = session?.user.id ?? "";
  const selectedFriendAvailable =
    invitationType === "link" ||
    Boolean(social?.friends.some((friend) => friend.user.userId === friendUserId));

  async function copyInvite(game: GameListItem) {
    if (!game.inviteCode) return;
    await navigator.clipboard.writeText(`${window.location.origin}/join/${game.inviteCode}`);
    setCopied(game.id);
    window.setTimeout(() => setCopied(null), 1800);
  }

  return (
    <main className="dashboard-page content-width">
      <section className="dashboard-heading">
        <div>
          <p className="eyebrow">Your game room</p>
          <h1>Ready when you are, {username}.</h1>
          <p>Start a private table or jump back into a match.</p>
        </div>
        <div className="create-panel">
          <label>
            Turn clock
            <select
              value={turnSeconds}
              onChange={(event) => setTurnSeconds(Number(event.target.value) as TurnSeconds)}
            >
              <option value={30}>30 seconds</option>
              <option value={60}>60 seconds</option>
              <option value={120}>2 minutes</option>
            </select>
          </label>
          <label>
            Invite with
            <select
              value={invitationType}
              onChange={(event) => setInvitationType(event.target.value as "link" | "friend")}
            >
              <option value="link">Share a link</option>
              <option value="friend" disabled={!social?.friends.length}>
                Choose a friend
              </option>
            </select>
          </label>
          {invitationType === "friend" && (
            <label>
              Friend
              <select
                value={friendUserId}
                onChange={(event) => setFriendUserId(event.target.value)}
              >
                <option value="">Select a friend</option>
                {social?.friends.map((friend) => (
                  <option key={friend.user.userId} value={friend.user.userId}>
                    {friend.user.username}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="button button--primary"
            disabled={create.isPending || !selectedFriendAvailable}
            onClick={() => create.mutate()}
          >
            <Plus size={19} />
            {create.isPending
              ? "Creating…"
              : invitationType === "friend"
                ? "Invite friend"
                : "New private game"}
          </button>
        </div>
      </section>
      {create.error && <Alert>{create.error.message}</Alert>}
      {cancel.error && <Alert>{cancel.error.message}</Alert>}
      {friendRequestAction.error && <Alert>{friendRequestAction.error.message}</Alert>}
      {gameInvitationAction.error && <Alert>{gameInvitationAction.error.message}</Alert>}

      {((social?.incomingFriendRequests.length ?? 0) > 0 ||
        (social?.incomingGameInvitations.length ?? 0) > 0) && (
        <section
          className="dashboard-section invitation-alerts"
          aria-labelledby="invitations-title"
        >
          <div className="section-title">
            <div>
              <BellRing />
              <h2 id="invitations-title">Invitations</h2>
            </div>
            <span>
              {(social?.incomingFriendRequests.length ?? 0) +
                (social?.incomingGameInvitations.length ?? 0)}
            </span>
          </div>
          <div className="social-list" aria-live="polite">
            {social?.incomingFriendRequests.map((request) => (
              <article className="social-row invitation-row" key={request.id}>
                <span className="social-avatar">
                  <UsersRound size={20} />
                </span>
                <div className="social-row__copy">
                  <strong>{request.user.username} sent you a friend request</strong>
                  <small>Accept before either of you can send a game challenge.</small>
                </div>
                <div className="social-row__actions">
                  <button
                    className="button button--soft"
                    onClick={() =>
                      friendRequestAction.mutate({ requestId: request.id, action: "accept" })
                    }
                  >
                    <Check size={17} /> Accept
                  </button>
                  <button
                    className="button button--ghost-dark"
                    onClick={() =>
                      friendRequestAction.mutate({ requestId: request.id, action: "decline" })
                    }
                  >
                    <X size={17} /> Decline
                  </button>
                </div>
              </article>
            ))}
            {social?.incomingGameInvitations.map((invitation) => (
              <article
                className="social-row invitation-row invitation-row--game"
                key={invitation.gameId}
              >
                <span className="social-avatar">
                  <Gamepad2 size={20} />
                </span>
                <div className="social-row__copy">
                  <strong>{invitation.host.username} invited you to play</strong>
                  <small>
                    {invitation.turnSeconds}-second turns · expires{" "}
                    {new Date(invitation.expiresAt).toLocaleString()}
                  </small>
                </div>
                <div className="social-row__actions">
                  <button
                    className="button button--soft"
                    onClick={() =>
                      gameInvitationAction.mutate({ gameId: invitation.gameId, action: "accept" })
                    }
                  >
                    <Check size={17} /> Play
                  </button>
                  <button
                    className="button button--ghost-dark"
                    onClick={() =>
                      gameInvitationAction.mutate({ gameId: invitation.gameId, action: "decline" })
                    }
                  >
                    <X size={17} /> Decline
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="dashboard-section">
        <div className="section-title">
          <div>
            <Gamepad2 />
            <h2>Active games</h2>
          </div>
          <span>{active.data?.items.length ?? 0}</span>
        </div>
        {active.isLoading ? (
          <div className="skeleton-list" aria-label="Loading games">
            <i />
            <i />
          </div>
        ) : active.data?.items.length ? (
          <div className="active-grid">
            {active.data.items.map((game) =>
              game.status === "waiting" ? (
                <article className="invite-card" key={game.id}>
                  <span className="invite-card__icon">
                    <Clock3 />
                  </span>
                  <div>
                    <p className="eyebrow">Waiting room</p>
                    <h3>
                      {game.pendingInvitee
                        ? `Waiting for ${game.pendingInvitee.username}`
                        : "Invite a friend"}
                    </h3>
                    <p>
                      {game.pendingInvitee
                        ? "Their seat is reserved until they accept or decline."
                        : `Your ${game.turnSeconds}-second game is ready.`}
                    </p>
                  </div>
                  <div className="invite-card__actions">
                    {!game.pendingInvitee && (
                      <button className="button button--soft" onClick={() => void copyInvite(game)}>
                        <Copy size={17} />
                        {copied === game.id ? "Copied" : "Copy link"}
                      </button>
                    )}
                    <Link className="button button--ghost" to={`/game/${game.id}`}>
                      Open
                    </Link>
                    <button
                      className="text-button text-button--danger"
                      disabled={cancel.isPending && cancel.variables === game.id}
                      onClick={() => cancel.mutate(game.id)}
                    >
                      <XCircle size={16} />
                      {cancel.isPending && cancel.variables === game.id ? "Cancelling…" : "Cancel"}
                    </button>
                  </div>
                </article>
              ) : (
                <GameResultRow key={game.id} game={game} userId={userId} />
              ),
            )}
          </div>
        ) : (
          <div className="empty-panel">
            <Gamepad2 />
            <h3>No games in motion</h3>
            <p>Create a private game and send the invite to a friend.</p>
          </div>
        )}
      </section>

      <section className="dashboard-section">
        <div className="section-title">
          <div>
            <Trophy />
            <h2>Recent results</h2>
          </div>
        </div>
        {history.isLoading ? (
          <div className="skeleton-list">
            <i />
            <i />
            <i />
          </div>
        ) : history.data?.items.length ? (
          <div className="game-list">
            {history.data.items.map((game) => (
              <GameResultRow key={game.id} game={game} userId={userId} />
            ))}
          </div>
        ) : (
          <div className="empty-panel empty-panel--compact">
            <p>Your completed games will appear here.</p>
          </div>
        )}
      </section>
    </main>
  );
}

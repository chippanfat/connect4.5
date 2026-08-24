import type {
  CreateGameResponse,
  GameListItem,
  GameListResponse,
  TurnSeconds,
} from "@four/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, Copy, Gamepad2, Plus, Trophy, XCircle } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "../api";
import { authClient } from "../auth-client";
import { Alert } from "../components";

function opponentName(game: GameListItem, userId: string) {
  return (
    game.players.find((player) => player.userId !== userId)?.username ?? "Waiting for a friend"
  );
}

function GameRow({ game, userId }: { game: GameListItem; userId: string }) {
  const opponent = opponentName(game, userId);
  const result =
    game.status === "waiting"
      ? "Invite ready"
      : game.status === "active"
        ? "In progress"
        : game.endReason === "draw"
          ? "Draw"
          : game.winnerUserId === userId
            ? "You won"
            : game.endReason === "cancelled" || game.endReason === "expired"
              ? "Not played"
              : "You lost";
  return (
    <Link className="game-list-row" to={`/game/${game.id}`}>
      <span
        className={`mini-disc mini-disc--${game.players.find((player) => player.userId === userId)?.color ?? "empty"}`}
      />
      <span className="game-list-row__main">
        <strong>{opponent}</strong>
        <small>
          {new Date(game.createdAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}{" "}
          · {game.turnSeconds}s turns
        </small>
      </span>
      <span className={`result-label result-label--${result.replaceAll(" ", "-").toLowerCase()}`}>
        {result}
      </span>
    </Link>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const [turnSeconds, setTurnSeconds] = useState<TurnSeconds>(60);
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
        body: JSON.stringify({ turnSeconds }),
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
  const username = session?.user.displayUsername ?? session?.user.username ?? "Player";
  const userId = session?.user.id ?? "";

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
          <button
            className="button button--primary"
            disabled={create.isPending}
            onClick={() => create.mutate()}
          >
            <Plus size={19} />
            {create.isPending ? "Creating…" : "New private game"}
          </button>
        </div>
      </section>
      {create.error && <Alert>{create.error.message}</Alert>}
      {cancel.error && <Alert>{cancel.error.message}</Alert>}

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
                    <h3>Invite a friend</h3>
                    <p>Your {game.turnSeconds}-second game is ready.</p>
                  </div>
                  <div className="invite-card__actions">
                    <button className="button button--soft" onClick={() => void copyInvite(game)}>
                      <Copy size={17} />
                      {copied === game.id ? "Copied" : "Copy link"}
                    </button>
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
                <GameRow key={game.id} game={game} userId={userId} />
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
              <GameRow key={game.id} game={game} userId={userId} />
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

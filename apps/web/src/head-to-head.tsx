import type { GameListItem, HeadToHead as HeadToHeadData } from "@four/contracts";
import { useQuery } from "@tanstack/react-query";
import { Info, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "./api";
import { Alert } from "./components";

function opponentName(game: GameListItem, userId: string) {
  return (
    game.players.find((player) => player.userId !== userId)?.username ??
    game.pendingInvitee?.username ??
    "Waiting for a friend"
  );
}

export function GameResultRow({ game, userId }: { game: GameListItem; userId: string }) {
  const opponent = opponentName(game, userId);
  const result =
    game.status === "waiting"
      ? "Invite ready"
      : game.status === "active"
        ? "In progress"
        : game.status === "cancelled" || game.status === "expired"
          ? "Not played"
          : game.endReason === "draw"
            ? "Draw"
            : game.winnerUserId === userId
              ? "You won"
              : "You lost";
  return (
    <Link className="game-list-row" to={`/game/${game.id}`}>
      <span
        className={`mini-disc mini-disc--${game.players.find((player) => player.userId === userId)?.color ?? "empty"}`}
      />
      <span className="game-list-row__main">
        <strong>{opponent}</strong>
        <small>
          {new Date(game.endedAt ?? game.createdAt).toLocaleDateString(undefined, {
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

interface HeadToHeadProps {
  viewerUserId: string;
  viewerUsername: string;
  opponentUserId: string;
  opponentUsername: string;
  className?: string;
}

export function HeadToHead({
  viewerUserId,
  viewerUsername,
  opponentUserId,
  opponentUsername,
  className = "",
}: HeadToHeadProps) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const query = useQuery({
    queryKey: ["head-to-head", opponentUserId, viewerUserId],
    queryFn: () =>
      api<HeadToHeadData>(`/api/games/head-to-head/${encodeURIComponent(opponentUserId)}`),
    enabled: Boolean(viewerUserId),
  });
  const data = query.data;
  const viewer = data?.viewer.username ?? viewerUsername;
  const opponent = data?.opponent.username ?? opponentUsername;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const recordLabel = query.isPending
    ? `Loading the record between ${viewer} and ${opponent}`
    : query.error
      ? `Could not load the record between ${viewer} and ${opponent}`
      : `${viewer} has won ${data?.viewerWins ?? 0} of ${data?.gamesPlayed ?? 0} games against ${opponent}. Open recent results.`;

  return (
    <>
      <button
        aria-label={recordLabel}
        className={`head-to-head ${className}`.trim()}
        onClick={() => setOpen(true)}
        type="button"
      >
        <span className="head-to-head__name">{viewer}</span>
        <strong className="head-to-head__record">
          {query.isPending ? "…/…" : `${data?.viewerWins ?? 0}/${data?.gamesPlayed ?? 0}`}
        </strong>
        <span className="head-to-head__name">{opponent}</span>
        <Info aria-hidden="true" size={15} />
      </button>

      <dialog
        aria-labelledby={`head-to-head-title-${opponentUserId}`}
        className="head-to-head-dialog"
        onCancel={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
        onClose={() => setOpen(false)}
        ref={dialogRef}
      >
        <div className="head-to-head-dialog__card">
          <header>
            <div>
              <p className="eyebrow">Head to head</p>
              <h2 id={`head-to-head-title-${opponentUserId}`}>Recent results</h2>
            </div>
            <button
              aria-label="Close recent results"
              className="icon-button"
              onClick={() => setOpen(false)}
              type="button"
            >
              <X size={19} />
            </button>
          </header>

          {query.error ? (
            <Alert>{query.error.message}</Alert>
          ) : query.isPending ? (
            <div className="skeleton-list" aria-label="Loading recent results">
              <i />
              <i />
              <i />
            </div>
          ) : data ? (
            <>
              <div className="head-to-head-dialog__score" aria-label={`${data.gamesPlayed} games`}>
                <div>
                  <span>{data.viewer.username}</span>
                  <strong>{data.viewerWins}</strong>
                  <small>wins</small>
                </div>
                <p>
                  <strong>{data.gamesPlayed}</strong>
                  <span>{data.gamesPlayed === 1 ? "game" : "games"}</span>
                  {data.draws > 0 && (
                    <small>
                      {data.draws} {data.draws === 1 ? "draw" : "draws"}
                    </small>
                  )}
                </p>
                <div>
                  <span>{data.opponent.username}</span>
                  <strong>{data.opponentWins}</strong>
                  <small>wins</small>
                </div>
              </div>
              {data.recentGames.length ? (
                <div className="game-list head-to-head-dialog__results">
                  {data.recentGames.map((game) => (
                    <GameResultRow game={game} key={game.id} userId={data.viewer.userId} />
                  ))}
                </div>
              ) : (
                <div className="empty-panel empty-panel--compact">
                  <p>No completed games between these players yet.</p>
                </div>
              )}
            </>
          ) : null}
        </div>
      </dialog>
    </>
  );
}

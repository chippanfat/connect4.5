import type {
  ClientToServerEvents,
  GameSnapshot,
  PresenceEvent,
  ServerToClientEvents,
} from "@four/contracts";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Copy, Flag, RefreshCcw, Wifi, WifiOff } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { io, type Socket } from "socket.io-client";

import { api } from "../api";
import { authClient } from "../auth-client";
import { Alert, PageLoader } from "../components";

interface BoardProps {
  game: GameSnapshot;
  canMove: boolean;
  pendingColumn: number | null;
  onMove: (column: number) => void;
}

function GameBoard({ game, canMove, pendingColumn, onMove }: BoardProps) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const winning = useMemo(
    () => new Set(game.winningCells.map(({ row, column }) => `${row}:${column}`)),
    [game.winningCells],
  );

  function keyDown(event: KeyboardEvent<HTMLButtonElement>, column: number) {
    let next: number;
    if (event.key === "ArrowLeft") next = Math.max(0, column - 1);
    else if (event.key === "ArrowRight") next = Math.min(6, column + 1);
    else if (/^[1-7]$/.test(event.key)) next = Number(event.key) - 1;
    else return;
    event.preventDefault();
    buttons.current[next]?.focus();
  }

  return (
    <div
      className={`live-board${game.status === "completed" ? " live-board--finished" : ""}`}
      role="group"
      aria-label="Four in a Row board"
    >
      {Array.from({ length: 7 }, (_, column) => {
        const full = game.board[0]?.[column] !== null;
        return (
          <button
            aria-label={`Drop a disc in column ${column + 1}${full ? ", column full" : ""}`}
            className={`board-column${pendingColumn === column ? " board-column--pending" : ""}`}
            disabled={!canMove || full || pendingColumn !== null}
            key={column}
            onClick={() => onMove(column)}
            onKeyDown={(event) => keyDown(event, column)}
            ref={(element) => {
              buttons.current[column] = element;
            }}
            type="button"
          >
            {game.board.map((row, rowIndex) => {
              const cell = row[column] ?? null;
              const isLast = game.lastMove?.row === rowIndex && game.lastMove.column === column;
              const isWinning = winning.has(`${rowIndex}:${column}`);
              return (
                <span
                  aria-hidden="true"
                  className={`board-cell${cell ? ` board-cell--${cell}` : ""}${isLast ? " board-cell--last" : ""}${isWinning ? " board-cell--winning" : ""}`}
                  key={rowIndex}
                >
                  {cell && <i>{cell === "red" ? "R" : "Y"}</i>}
                </span>
              );
            })}
          </button>
        );
      })}
    </div>
  );
}

function useCountdown(game: GameSnapshot | undefined) {
  const [clock, setClock] = useState({ source: "", serverNow: 0 });
  useEffect(() => {
    if (!game?.turnDeadlineAt) return;
    const source = game.serverTime;
    const clientReceivedAt = Date.now();
    const serverReceivedAt = new Date(source).getTime();
    const timer = window.setInterval(() => {
      setClock({ source, serverNow: serverReceivedAt + Date.now() - clientReceivedAt });
    }, 250);
    return () => window.clearInterval(timer);
  }, [game?.serverTime, game?.turnDeadlineAt]);
  if (!game?.turnDeadlineAt) return 0;
  const serverNow =
    clock.source === game.serverTime ? clock.serverNow : new Date(game.serverTime).getTime();
  const remaining = Math.max(0, new Date(game.turnDeadlineAt).getTime() - serverNow);
  return Math.ceil(remaining / 1000);
}

export function GamePage() {
  const { gameId = "" } = useParams();
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const initial = useQuery({
    queryKey: ["game", gameId],
    queryFn: () => api<GameSnapshot>(`/api/games/${gameId}`),
    retry: false,
  });
  const [liveGame, setGame] = useState<GameSnapshot | undefined>();
  const [connected, setConnected] = useState(false);
  const [connectedUsers, setConnectedUsers] = useState<string[]>([]);
  const [pendingColumn, setPendingColumn] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const game = liveGame?.id === gameId ? liveGame : initial.data;
  const seconds = useCountdown(game);

  useEffect(() => {
    if (!gameId) return;
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io("/game", {
      path: "/socket.io",
      withCredentials: true,
    });
    socketRef.current = socket;
    socket.on("connect", () => {
      setConnected(true);
      socket.emit("game:subscribe", { gameId }, (result) => {
        if (result.ok) {
          setGame(result.data);
          setError(null);
        } else setError(result.error.message);
      });
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("game:state", (next) => {
      setGame(next);
      setPendingColumn(null);
    });
    socket.on("game:presence", (presence: PresenceEvent) =>
      setConnectedUsers(presence.connectedUserIds),
    );
    socket.on("game:rematch-created", ({ game: next }) => navigate(`/game/${next.id}`));
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [gameId, navigate]);

  if (initial.isLoading && !game) return <PageLoader label="Setting the board" />;
  if (initial.error || !game)
    return (
      <main className="game-error content-width">
        <Alert>{initial.error?.message ?? "This game could not be loaded."}</Alert>
        <Link className="button button--soft" to="/dashboard">
          Back to your games
        </Link>
      </main>
    );

  const userId = session?.user.id ?? "";
  const me = game.players.find((player) => player.userId === userId);
  const opponent = game.players.find((player) => player.userId !== userId);
  const myTurn = game.currentTurnUserId === userId;
  const canMove = connected && game.status === "active" && myTurn && seconds > 0;
  const requested = game.rematchRequestedBy.includes(userId);
  const opponentRequested = opponent ? game.rematchRequestedBy.includes(opponent.userId) : false;

  const statusText =
    game.status === "waiting"
      ? "Waiting for your opponent"
      : game.status === "active"
        ? myTurn
          ? "Your turn"
          : `${opponent?.username ?? "Opponent"} is thinking`
        : game.endReason === "draw"
          ? "It’s a draw"
          : game.winnerUserId === userId
            ? game.endReason === "timeout"
              ? "You won on time"
              : "You won!"
            : game.endReason === "cancelled" || game.endReason === "expired"
              ? "Game not played"
              : `${opponent?.username ?? "Your opponent"} won`;

  function move(column: number) {
    const socket = socketRef.current;
    if (!socket || !game) return;
    setPendingColumn(column);
    setError(null);
    socket.emit(
      "game:move",
      {
        gameId: game.id,
        commandId: crypto.randomUUID(),
        column,
        expectedVersion: game.stateVersion,
      },
      (result) => {
        setPendingColumn(null);
        if (result.ok) setGame(result.data);
        else {
          setError(result.error.message);
          void initial.refetch();
        }
      },
    );
  }

  function resign() {
    const socket = socketRef.current;
    if (!socket || !game) return;
    socket.emit("game:resign", { gameId: game.id, commandId: crypto.randomUUID() }, (result) => {
      setConfirmResign(false);
      if (result.ok) setGame(result.data);
      else setError(result.error.message);
    });
  }

  function rematch() {
    const socket = socketRef.current;
    if (!socket || !game) return;
    socket.emit(
      "game:rematch-request",
      { gameId: game.id, commandId: crypto.randomUUID(), requested: !requested },
      (result) => {
        if (result.ok) {
          setGame(result.data.game);
          if (result.data.nextGame) navigate(`/game/${result.data.nextGame.id}`);
        } else setError(result.error.message);
      },
    );
  }

  async function copyInvite() {
    if (!game?.inviteCode) return;
    await navigator.clipboard.writeText(`${window.location.origin}/join/${game.inviteCode}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="live-game-page">
      <div className="game-topbar content-width">
        <Link to="/dashboard">
          <ArrowLeft size={18} />
          Games
        </Link>
        <span className={`connection-pill ${connected ? "connection-pill--online" : ""}`}>
          {connected ? <Wifi size={15} /> : <WifiOff size={15} />}
          {connected ? "Live" : "Reconnecting"}
        </span>
      </div>
      <section className="game-stage content-width">
        <aside className="player-panel player-panel--left">
          <span className={`avatar-disc avatar-disc--${me?.color ?? "empty"}`}>
            <i>{me?.username.slice(0, 1).toUpperCase()}</i>
          </span>
          <div>
            <small>You</small>
            <strong>{me?.username}</strong>
            <span>{connectedUsers.includes(userId) ? "Connected" : "Offline"}</span>
          </div>
        </aside>
        <div className="board-area">
          <div className="game-status">
            <p>{statusText}</p>
            {game.status === "active" && (
              <strong className={seconds <= 10 ? "clock clock--warning" : "clock"}>
                {seconds}s
              </strong>
            )}
          </div>
          <GameBoard game={game} canMove={canMove} pendingColumn={pendingColumn} onMove={move} />
          <p className="board-hint" aria-live="polite">
            {game.status === "active"
              ? myTurn
                ? canMove
                  ? `Choose a column for your ${me?.color ?? ""} disc`
                  : connected
                    ? "Time is up — settling the game…"
                    : "Your game will resync when connected"
                : `Waiting for ${opponent?.username ?? "your opponent"}`
              : statusText}
          </p>
        </div>
        <aside className="player-panel player-panel--right">
          <span className={`avatar-disc avatar-disc--${opponent?.color ?? "empty"}`}>
            <i>{opponent?.username.slice(0, 1).toUpperCase() ?? "?"}</i>
          </span>
          <div>
            <small>Opponent</small>
            <strong>{opponent?.username ?? "Waiting…"}</strong>
            <span>
              {opponent && connectedUsers.includes(opponent.userId) ? "Connected" : "Offline"}
            </span>
          </div>
        </aside>
      </section>
      <section className="game-actions content-width">
        {error && <Alert>{error}</Alert>}
        {game.status === "waiting" && (
          <div className="waiting-panel">
            <div>
              <p className="eyebrow">Your private table</p>
              <h2>Send the invite to a friend</h2>
              <p>The seat is only claimed after they sign in and choose to join.</p>
            </div>
            <button className="button button--primary" onClick={() => void copyInvite()}>
              {copied ? <Check size={18} /> : <Copy size={18} />}
              {copied ? "Invite copied" : "Copy invite link"}
            </button>
          </div>
        )}
        {game.status === "active" && (
          <div className="resign-area">
            {confirmResign ? (
              <div className="confirm-row">
                <span>Resign this game?</span>
                <button className="button button--danger" onClick={resign}>
                  Yes, resign
                </button>
                <button className="button button--ghost" onClick={() => setConfirmResign(false)}>
                  Keep playing
                </button>
              </div>
            ) : (
              <button className="text-button" onClick={() => setConfirmResign(true)}>
                <Flag size={16} />
                Resign game
              </button>
            )}
          </div>
        )}
        {game.status === "completed" && game.players.length === 2 && (
          <div className="rematch-panel">
            <div>
              <p className="eyebrow">Play again</p>
              <h2>
                {opponentRequested && !requested
                  ? `${opponent?.username} wants a rematch`
                  : requested
                    ? "Waiting for your opponent"
                    : "Same table, colors swapped"}
              </h2>
              <p>
                The next game keeps the {game.turnSeconds}-second clock and alternates who starts.
              </p>
            </div>
            <button
              className={`button ${requested ? "button--ghost" : "button--primary"}`}
              onClick={rematch}
            >
              <RefreshCcw size={18} />
              {requested ? "Cancel request" : "Request rematch"}
            </button>
          </div>
        )}
      </section>
    </main>
  );
}

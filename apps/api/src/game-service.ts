import { randomBytes, randomUUID } from "node:crypto";

import type {
  GameInvitationSelection,
  GameListItem,
  GameListResponse,
  GameSnapshot,
  HeadToHead,
  InvitePreview,
  MoveCommand,
  RematchCommand,
  ResignCommand,
  TurnSeconds,
} from "@four/contracts";
import {
  friendships,
  gameMoves,
  games,
  rematchRequests,
  user,
  type Database,
  type GameRow,
} from "@four/db";
import { applyMove, createBoard, isValidBoard, type DiscColor } from "@four/game-engine";
import { and, count, desc, eq, inArray, lt, or, sql } from "drizzle-orm";

import { AppError } from "./errors";

const ACTIVE_STATUSES = ["waiting", "active"] as const;
const HISTORY_STATUSES = ["completed", "cancelled", "expired"] as const;

function inviteCode() {
  return randomBytes(16).toString("base64url");
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function isParticipant(game: GameRow, userId: string): boolean {
  return game.hostUserId === userId || game.guestUserId === userId;
}

function opponentOf(game: GameRow, userId: string): string {
  const opponent = game.hostUserId === userId ? game.guestUserId : game.hostUserId;
  if (!opponent) throw new AppError("GAME_FINISHED", "This game does not have two players.");
  return opponent;
}

function colorFor(game: GameRow, userId: string): DiscColor | null {
  if (game.redUserId === userId) return "red";
  if (game.yellowUserId === userId) return "yellow";
  return null;
}

function listItem(game: GameSnapshot): GameListItem {
  return {
    id: game.id,
    status: game.status,
    players: game.players,
    hostUserId: game.hostUserId,
    winnerUserId: game.winnerUserId,
    endReason: game.endReason,
    turnSeconds: game.turnSeconds,
    turnDeadlineAt: game.turnDeadlineAt,
    inviteCode: game.inviteCode,
    inviteExpiresAt: game.inviteExpiresAt,
    pendingInvitee: game.pendingInvitee,
    createdAt: game.createdAt,
    startedAt: game.startedAt,
    endedAt: game.endedAt,
  };
}

export interface GameMutationResult {
  game: GameSnapshot;
  changed: boolean;
  error?: AppError;
}

export interface RematchResult extends GameMutationResult {
  nextGame: GameSnapshot | null;
}

export interface SettledTimeout {
  gameId: string;
  stateVersion: number;
  deadline: Date;
}

export interface ExpiredInvitation {
  gameId: string;
  stateVersion: number;
  affectedUserIds: string[];
}

function canonicalPair(firstUserId: string, secondUserId: string) {
  return firstUserId < secondUserId
    ? { userAId: firstUserId, userBId: secondUserId }
    : { userAId: secondUserId, userBId: firstUserId };
}

function isUniqueViolation(error: unknown, constraint: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === constraint
  );
}

export class GameService {
  constructor(private readonly db: Database) {}

  async activeGameCount(): Promise<number> {
    const [result] = await this.db
      .select({ value: count() })
      .from(games)
      .where(inArray(games.status, ACTIVE_STATUSES));
    return result?.value ?? 0;
  }

  async createGame(
    hostUserId: string,
    turnSeconds: TurnSeconds,
    invitation: GameInvitationSelection = { type: "link" },
  ): Promise<GameSnapshot> {
    const now = new Date();
    let created: { id: string } | undefined;
    try {
      created = await this.db.transaction(async (tx) => {
        if (invitation.type === "friend") {
          if (invitation.userId === hostUserId) {
            throw new AppError("CANNOT_ADD_SELF", "Choose another friend to play against.");
          }
          const pair = canonicalPair(hostUserId, invitation.userId);
          const [friendship] = await tx
            .select({ status: friendships.status })
            .from(friendships)
            .where(
              and(eq(friendships.userAId, pair.userAId), eq(friendships.userBId, pair.userBId)),
            )
            .limit(1)
            .for("update");
          if (friendship?.status !== "accepted") {
            throw new AppError(
              "FRIENDSHIP_REQUIRED",
              "Become friends before sending a game invitation.",
            );
          }
        }

        const [result] = await tx
          .insert(games)
          .values({
            seriesId: randomUUID(),
            inviteCode: invitation.type === "link" ? inviteCode() : null,
            invitedUserId: invitation.type === "friend" ? invitation.userId : null,
            inviteExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            hostUserId,
            board: createBoard(),
            turnSeconds,
          })
          .returning({ id: games.id });
        return result;
      });
    } catch (error) {
      if (isUniqueViolation(error, "games_pending_friend_pair_idx")) {
        throw new AppError(
          "GAME_INVITE_EXISTS",
          "There is already an unanswered game invitation between you.",
        );
      }
      throw error;
    }

    if (!created) throw new AppError("INTERNAL_ERROR", "Unable to create the game.");
    return this.getSnapshot(created.id, hostUserId);
  }

  async getInvitePreview(code: string): Promise<InvitePreview> {
    const [result] = await this.db
      .select({ game: games, host: user })
      .from(games)
      .innerJoin(user, eq(user.id, games.hostUserId))
      .where(eq(games.inviteCode, code))
      .limit(1);

    if (!result) throw new AppError("GAME_NOT_FOUND", "This invite could not be found.");
    const expired = result.game.status === "waiting" && result.game.inviteExpiresAt <= new Date();
    return {
      hostUsername: result.host.displayUsername ?? result.host.username ?? result.host.name,
      turnSeconds: result.game.turnSeconds as TurnSeconds,
      status: expired ? "expired" : result.game.status,
      expiresAt: result.game.inviteExpiresAt.toISOString(),
    };
  }

  async joinGame(code: string, guestUserId: string): Promise<GameSnapshot> {
    const outcome = await this.db.transaction(async (tx) => {
      const [game] = await tx
        .select()
        .from(games)
        .where(eq(games.inviteCode, code))
        .limit(1)
        .for("update");

      if (!game)
        return { error: new AppError("GAME_NOT_FOUND", "This invite could not be found.") };
      if (game.hostUserId === guestUserId) {
        return { gameId: game.id };
      }

      if (game.invitedUserId) {
        return { error: new AppError("GAME_RESERVED", "This game is reserved for a friend.") };
      }

      const now = new Date();
      if (game.status === "expired" || game.inviteExpiresAt <= now) {
        if (game.status === "waiting") {
          await tx
            .update(games)
            .set({
              status: "expired",
              endReason: "expired",
              endedAt: now,
              stateVersion: game.stateVersion + 1,
            })
            .where(eq(games.id, game.id));
        }
        return { error: new AppError("INVITE_EXPIRED", "This invitation has expired.") };
      }
      if (game.status !== "waiting" || game.guestUserId) {
        return { error: new AppError("GAME_FULL", "This game already has two players.") };
      }

      const hostStarts = (randomBytes(1)[0] ?? 0) % 2 === 0;
      const redUserId = hostStarts ? game.hostUserId : guestUserId;
      const yellowUserId = hostStarts ? guestUserId : game.hostUserId;
      await tx
        .update(games)
        .set({
          guestUserId,
          redUserId,
          yellowUserId,
          currentTurnUserId: redUserId,
          status: "active",
          startedAt: now,
          turnDeadlineAt: new Date(now.getTime() + game.turnSeconds * 1000),
          stateVersion: game.stateVersion + 1,
        })
        .where(eq(games.id, game.id));

      return { gameId: game.id };
    });

    if (outcome.error) throw outcome.error;
    if (!outcome.gameId) throw new AppError("INTERNAL_ERROR", "Unable to join the game.");
    return this.getSnapshot(outcome.gameId, guestUserId);
  }

  async cancelGame(gameId: string, userId: string): Promise<GameSnapshot> {
    await this.db.transaction(async (tx) => {
      const [game] = await tx
        .select()
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1)
        .for("update");
      if (!game) throw new AppError("GAME_NOT_FOUND", "This game could not be found.");
      if (game.hostUserId !== userId)
        throw new AppError("FORBIDDEN", "Only the host can cancel this invite.");
      if (game.status !== "waiting")
        throw new AppError("GAME_FINISHED", "This invitation can no longer be cancelled.");

      const now = new Date();
      await tx
        .update(games)
        .set({
          status: "cancelled",
          endReason: "cancelled",
          endedAt: now,
          turnDeadlineAt: null,
          stateVersion: game.stateVersion + 1,
        })
        .where(eq(games.id, game.id));
    });
    return this.getSnapshot(gameId, userId);
  }

  async acceptGameInvitation(gameId: string, userId: string): Promise<GameSnapshot> {
    const [candidate] = await this.db.select().from(games).where(eq(games.id, gameId)).limit(1);
    if (!candidate) throw new AppError("GAME_NOT_FOUND", "This invitation could not be found.");
    if (candidate.status === "active" && candidate.guestUserId === userId) {
      return this.getSnapshot(candidate.id, userId);
    }
    if (candidate.invitedUserId !== userId) {
      throw new AppError("INVITE_NOT_FOR_YOU", "This game invitation is for another player.");
    }
    const pair = canonicalPair(candidate.hostUserId, userId);
    const outcome = await this.db.transaction(async (tx) => {
      const [friendship] = await tx
        .select({ status: friendships.status })
        .from(friendships)
        .where(and(eq(friendships.userAId, pair.userAId), eq(friendships.userBId, pair.userBId)))
        .limit(1)
        .for("update");
      if (friendship?.status !== "accepted") {
        throw new AppError(
          "FRIENDSHIP_REQUIRED",
          "You must still be friends to accept this invitation.",
        );
      }

      const [game] = await tx
        .select()
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1)
        .for("update");
      if (!game) throw new AppError("GAME_NOT_FOUND", "This invitation could not be found.");
      if (game.status === "active" && game.guestUserId === userId) return { gameId: game.id };
      if (game.invitedUserId !== userId) {
        throw new AppError("INVITE_NOT_FOR_YOU", "This game invitation is for another player.");
      }

      const now = new Date();
      if (game.status === "expired" || game.inviteExpiresAt <= now) {
        if (game.status === "waiting") {
          await tx
            .update(games)
            .set({
              status: "expired",
              endReason: "expired",
              endedAt: now,
              stateVersion: game.stateVersion + 1,
            })
            .where(eq(games.id, game.id));
        }
        return {
          error: new AppError("INVITE_EXPIRED", "This invitation has expired."),
          gameId: game.id,
        };
      }
      if (game.status !== "waiting") {
        throw new AppError("GAME_FINISHED", "This invitation can no longer be accepted.");
      }

      const hostStarts = (randomBytes(1)[0] ?? 0) % 2 === 0;
      const redUserId = hostStarts ? game.hostUserId : userId;
      const yellowUserId = hostStarts ? userId : game.hostUserId;
      await tx
        .update(games)
        .set({
          guestUserId: userId,
          redUserId,
          yellowUserId,
          currentTurnUserId: redUserId,
          status: "active",
          startedAt: now,
          turnDeadlineAt: new Date(now.getTime() + game.turnSeconds * 1000),
          stateVersion: game.stateVersion + 1,
        })
        .where(eq(games.id, game.id));
      return { gameId: game.id };
    });
    if (outcome.error) throw outcome.error;
    return this.getSnapshot(outcome.gameId, userId);
  }

  async declineGameInvitation(gameId: string, userId: string): Promise<GameSnapshot> {
    const outcome = await this.db.transaction(async (tx) => {
      const [game] = await tx
        .select()
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1)
        .for("update");
      if (!game) throw new AppError("GAME_NOT_FOUND", "This invitation could not be found.");
      if (game.invitedUserId !== userId) {
        throw new AppError("INVITE_NOT_FOR_YOU", "This game invitation is for another player.");
      }
      if (game.status === "cancelled" && game.endReason === "declined") return;
      const now = new Date();
      if (game.status === "expired" || game.inviteExpiresAt <= now) {
        if (game.status === "waiting") {
          await tx
            .update(games)
            .set({
              status: "expired",
              endReason: "expired",
              endedAt: now,
              stateVersion: game.stateVersion + 1,
            })
            .where(eq(games.id, game.id));
        }
        return new AppError("INVITE_EXPIRED", "This invitation has expired.");
      }
      if (game.status !== "waiting") {
        throw new AppError("GAME_FINISHED", "This invitation can no longer be declined.");
      }
      await tx
        .update(games)
        .set({
          status: "cancelled",
          endReason: "declined",
          endedAt: now,
          stateVersion: game.stateVersion + 1,
        })
        .where(eq(games.id, game.id));
    });
    if (outcome instanceof AppError) throw outcome;
    return this.getSnapshot(gameId, null);
  }

  async getSnapshot(gameId: string, requestingUserId: string | null): Promise<GameSnapshot> {
    const [game] = await this.db.select().from(games).where(eq(games.id, gameId)).limit(1);
    if (!game) throw new AppError("GAME_NOT_FOUND", "This game could not be found.");
    if (requestingUserId && !isParticipant(game, requestingUserId)) {
      throw new AppError("FORBIDDEN", "You are not a player in this game.");
    }

    const userIds = [...new Set([game.hostUserId, game.guestUserId, game.invitedUserId])].filter(
      (value): value is string => Boolean(value),
    );
    const [players, requests, recentMoves] = await Promise.all([
      this.db.select().from(user).where(inArray(user.id, userIds)),
      this.db
        .select({ userId: rematchRequests.userId })
        .from(rematchRequests)
        .where(eq(rematchRequests.gameId, gameId)),
      this.db
        .select()
        .from(gameMoves)
        .where(eq(gameMoves.gameId, gameId))
        .orderBy(desc(gameMoves.sequence))
        .limit(1),
    ]);
    const usersById = new Map(players.map((player) => [player.id, player]));
    const participantIds = [game.hostUserId, game.guestUserId].filter((value): value is string =>
      Boolean(value),
    );
    const publicPlayers = participantIds.map((userId) => {
      const player = usersById.get(userId);
      if (!player) throw new AppError("INTERNAL_ERROR", "A game player could not be loaded.");
      return {
        userId,
        username: player.displayUsername ?? player.username ?? player.name,
        color: colorFor(game, userId),
      };
    });
    const last = recentMoves[0];

    if (!isValidBoard(game.board)) {
      throw new AppError("INTERNAL_ERROR", "The stored game board is invalid.");
    }

    return {
      id: game.id,
      status: game.status,
      board: game.board,
      players: publicPlayers,
      hostUserId: game.hostUserId,
      currentTurnUserId: game.currentTurnUserId,
      winnerUserId: game.winnerUserId,
      endReason: game.endReason,
      moveCount: game.moveCount,
      stateVersion: game.stateVersion,
      turnSeconds: game.turnSeconds as TurnSeconds,
      turnDeadlineAt: iso(game.turnDeadlineAt),
      inviteCode: game.status === "waiting" ? game.inviteCode : null,
      inviteExpiresAt: game.status === "waiting" ? game.inviteExpiresAt.toISOString() : null,
      pendingInvitee: game.invitedUserId
        ? {
            userId: game.invitedUserId,
            username:
              usersById.get(game.invitedUserId)?.displayUsername ??
              usersById.get(game.invitedUserId)?.username ??
              usersById.get(game.invitedUserId)?.name ??
              "Player",
          }
        : null,
      rematchRequestedBy: requests.map((request) => request.userId),
      seriesId: game.seriesId,
      rematchOfId: game.rematchOfId,
      lastMove: last
        ? {
            row: last.row,
            column: last.column,
            color: last.color as DiscColor,
            playerId: last.playerId,
            sequence: last.sequence,
          }
        : null,
      winningCells: game.winningCells,
      createdAt: game.createdAt.toISOString(),
      startedAt: iso(game.startedAt),
      endedAt: iso(game.endedAt),
      serverTime: new Date().toISOString(),
    };
  }

  async listGames(
    userId: string,
    status: "active" | "completed",
    cursor: string | undefined,
    limit: number,
  ): Promise<GameListResponse> {
    const statuses = status === "active" ? ACTIVE_STATUSES : HISTORY_STATUSES;
    const participant = or(eq(games.hostUserId, userId), eq(games.guestUserId, userId));
    const predicate = cursor
      ? and(participant, inArray(games.status, statuses), lt(games.createdAt, new Date(cursor)))
      : and(participant, inArray(games.status, statuses));
    const rows = await this.db
      .select({ id: games.id, createdAt: games.createdAt })
      .from(games)
      .where(predicate)
      .orderBy(desc(games.createdAt))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const snapshots = await Promise.all(page.map((row) => this.getSnapshot(row.id, userId)));
    return {
      items: snapshots.map(listItem),
      nextCursor: rows.length > limit ? (page.at(-1)?.createdAt.toISOString() ?? null) : null,
    };
  }

  async getHeadToHead(
    viewerUserId: string,
    opponentUserId: string,
    recentLimit = 8,
  ): Promise<HeadToHead> {
    if (viewerUserId === opponentUserId) {
      throw new AppError("CANNOT_ADD_SELF", "Choose another player to compare results with.");
    }

    const pair = or(
      and(eq(games.hostUserId, viewerUserId), eq(games.guestUserId, opponentUserId)),
      and(eq(games.hostUserId, opponentUserId), eq(games.guestUserId, viewerUserId)),
    );
    const completedPair = and(eq(games.status, "completed"), pair);
    const [accounts, totals, recentRows] = await Promise.all([
      this.db
        .select()
        .from(user)
        .where(inArray(user.id, [viewerUserId, opponentUserId])),
      this.db
        .select({
          gamesPlayed: sql<number>`count(*)::int`,
          viewerWins: sql<number>`coalesce(sum(case when ${games.winnerUserId} = ${viewerUserId} then 1 else 0 end), 0)::int`,
          opponentWins: sql<number>`coalesce(sum(case when ${games.winnerUserId} = ${opponentUserId} then 1 else 0 end), 0)::int`,
          draws: sql<number>`coalesce(sum(case when ${games.endReason} = 'draw' then 1 else 0 end), 0)::int`,
        })
        .from(games)
        .where(completedPair),
      this.db
        .select({ id: games.id })
        .from(games)
        .where(completedPair)
        .orderBy(desc(games.endedAt), desc(games.createdAt))
        .limit(recentLimit),
    ]);

    const accountsById = new Map(accounts.map((account) => [account.id, account]));
    const viewer = accountsById.get(viewerUserId);
    const opponent = accountsById.get(opponentUserId);
    if (!viewer) throw new AppError("UNAUTHENTICATED", "Sign in to compare game results.");
    if (!opponent) throw new AppError("USER_NOT_FOUND", "This player could not be found.");

    const recentGames = await Promise.all(
      recentRows.map(async ({ id }) => listItem(await this.getSnapshot(id, viewerUserId))),
    );
    const total = totals[0];
    return {
      viewer: {
        userId: viewer.id,
        username: viewer.displayUsername ?? viewer.username ?? viewer.name,
      },
      opponent: {
        userId: opponent.id,
        username: opponent.displayUsername ?? opponent.username ?? opponent.name,
      },
      viewerWins: total?.viewerWins ?? 0,
      opponentWins: total?.opponentWins ?? 0,
      draws: total?.draws ?? 0,
      gamesPlayed: total?.gamesPlayed ?? 0,
      recentGames,
    };
  }

  async makeMove(userId: string, command: MoveCommand): Promise<GameMutationResult> {
    const outcome = await this.db.transaction(async (tx) => {
      const [game] = await tx
        .select()
        .from(games)
        .where(eq(games.id, command.gameId))
        .limit(1)
        .for("update");
      if (!game) throw new AppError("GAME_NOT_FOUND", "This game could not be found.");
      if (!isParticipant(game, userId))
        throw new AppError("FORBIDDEN", "You are not a player in this game.");

      const [duplicate] = await tx
        .select({ id: gameMoves.id })
        .from(gameMoves)
        .where(
          and(
            eq(gameMoves.gameId, game.id),
            eq(gameMoves.playerId, userId),
            eq(gameMoves.commandId, command.commandId),
          ),
        )
        .limit(1);
      if (duplicate) return { changed: false };

      if (game.status !== "active") throw new AppError("GAME_FINISHED", "This game has finished.");
      if (game.stateVersion !== command.expectedVersion) {
        throw new AppError(
          "STALE_VERSION",
          "The game changed. The latest board has been restored.",
        );
      }
      if (game.currentTurnUserId !== userId)
        throw new AppError("NOT_YOUR_TURN", "It is not your turn.");

      const now = new Date();
      if (!game.turnDeadlineAt || game.turnDeadlineAt <= now) {
        const winnerUserId = opponentOf(game, userId);
        await tx
          .update(games)
          .set({
            status: "completed",
            endReason: "timeout",
            winnerUserId,
            currentTurnUserId: null,
            turnDeadlineAt: null,
            endedAt: now,
            stateVersion: game.stateVersion + 1,
          })
          .where(eq(games.id, game.id));
        return {
          changed: true,
          error: new AppError("CLOCK_EXPIRED", "The turn clock expired before the move arrived."),
        };
      }

      if (!isValidBoard(game.board))
        throw new AppError("INTERNAL_ERROR", "The stored game board is invalid.");
      const color = colorFor(game, userId);
      if (!color) throw new AppError("FORBIDDEN", "You do not have a disc color in this game.");
      const move = applyMove(game.board, command.column, color);
      if (!move.ok) {
        if (move.reason === "COLUMN_FULL")
          throw new AppError("COLUMN_FULL", "That column is full.");
        throw new AppError("VALIDATION_ERROR", "Choose a column from 1 to 7.");
      }

      const nextPlayerId = opponentOf(game, userId);
      const completed = move.isWin || move.isDraw;
      await tx.insert(gameMoves).values({
        gameId: game.id,
        playerId: userId,
        commandId: command.commandId,
        sequence: game.moveCount + 1,
        column: move.column,
        row: move.row,
        color,
      });
      await tx
        .update(games)
        .set({
          board: move.board,
          winningCells: move.winningCells,
          moveCount: game.moveCount + 1,
          stateVersion: game.stateVersion + 1,
          status: completed ? "completed" : "active",
          endReason: move.isWin ? "connect_four" : move.isDraw ? "draw" : null,
          winnerUserId: move.isWin ? userId : null,
          currentTurnUserId: completed ? null : nextPlayerId,
          turnDeadlineAt: completed ? null : new Date(now.getTime() + game.turnSeconds * 1000),
          endedAt: completed ? now : null,
        })
        .where(eq(games.id, game.id));
      return { changed: true };
    });

    const game = await this.getSnapshot(command.gameId, userId);
    return { game, changed: outcome.changed, error: outcome.error };
  }

  async resign(userId: string, command: ResignCommand): Promise<GameMutationResult> {
    const changed = await this.db.transaction(async (tx) => {
      const [game] = await tx
        .select()
        .from(games)
        .where(eq(games.id, command.gameId))
        .limit(1)
        .for("update");
      if (!game) throw new AppError("GAME_NOT_FOUND", "This game could not be found.");
      if (!isParticipant(game, userId))
        throw new AppError("FORBIDDEN", "You are not a player in this game.");
      if (
        game.status === "completed" &&
        game.endReason === "resignation" &&
        game.endCommandId === command.commandId
      ) {
        return false;
      }
      if (game.status !== "active") throw new AppError("GAME_FINISHED", "This game has finished.");
      const now = new Date();
      await tx
        .update(games)
        .set({
          status: "completed",
          endReason: "resignation",
          endCommandId: command.commandId,
          winnerUserId: opponentOf(game, userId),
          currentTurnUserId: null,
          turnDeadlineAt: null,
          endedAt: now,
          stateVersion: game.stateVersion + 1,
        })
        .where(eq(games.id, game.id));
      return true;
    });
    return { game: await this.getSnapshot(command.gameId, userId), changed };
  }

  async requestRematch(userId: string, command: RematchCommand): Promise<RematchResult> {
    const outcome = await this.db.transaction(async (tx) => {
      const [game] = await tx
        .select()
        .from(games)
        .where(eq(games.id, command.gameId))
        .limit(1)
        .for("update");
      if (!game) throw new AppError("GAME_NOT_FOUND", "This game could not be found.");
      if (!isParticipant(game, userId))
        throw new AppError("FORBIDDEN", "You are not a player in this game.");
      if (
        game.status !== "completed" ||
        !game.guestUserId ||
        !game.redUserId ||
        !game.yellowUserId
      ) {
        throw new AppError("GAME_FINISHED", "A rematch is not available for this game.");
      }

      const [existingNext] = await tx
        .select({ id: games.id })
        .from(games)
        .where(eq(games.rematchOfId, game.id))
        .limit(1);
      if (existingNext) return { changed: false, nextGameId: existingNext.id };

      let requestChanged: boolean;
      if (command.requested) {
        const inserted = await tx
          .insert(rematchRequests)
          .values({ gameId: game.id, userId, commandId: command.commandId })
          .onConflictDoNothing()
          .returning({ userId: rematchRequests.userId });
        requestChanged = inserted.length > 0;
      } else {
        const deleted = await tx
          .delete(rematchRequests)
          .where(and(eq(rematchRequests.gameId, game.id), eq(rematchRequests.userId, userId)))
          .returning({ userId: rematchRequests.userId });
        requestChanged = deleted.length > 0;
      }

      const requests = await tx
        .select({ userId: rematchRequests.userId })
        .from(rematchRequests)
        .where(eq(rematchRequests.gameId, game.id));
      let nextGameId: string | undefined;
      if (requests.length === 2) {
        const now = new Date();
        const [created] = await tx
          .insert(games)
          .values({
            seriesId: game.seriesId,
            rematchOfId: game.id,
            inviteCode: inviteCode(),
            inviteExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            status: "active",
            hostUserId: game.hostUserId,
            guestUserId: game.guestUserId,
            redUserId: game.yellowUserId,
            yellowUserId: game.redUserId,
            currentTurnUserId: game.yellowUserId,
            board: createBoard(),
            turnSeconds: game.turnSeconds,
            turnDeadlineAt: new Date(now.getTime() + game.turnSeconds * 1000),
            startedAt: now,
          })
          .returning({ id: games.id });
        nextGameId = created?.id;
      }

      const changed = requestChanged || Boolean(nextGameId);
      if (changed) {
        await tx
          .update(games)
          .set({ stateVersion: game.stateVersion + 1 })
          .where(eq(games.id, game.id));
      }
      return { changed, nextGameId };
    });

    const [game, nextGame] = await Promise.all([
      this.getSnapshot(command.gameId, userId),
      outcome.nextGameId ? this.getSnapshot(outcome.nextGameId, userId) : Promise.resolve(null),
    ]);
    return { game, nextGame, changed: outcome.changed };
  }

  async settleExpiredGames(limit = 50): Promise<SettledTimeout[]> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const expired = await tx
        .select()
        .from(games)
        .where(and(eq(games.status, "active"), sql`${games.turnDeadlineAt} <= ${now}`))
        .limit(limit)
        .for("update", { skipLocked: true });
      const settled: SettledTimeout[] = [];
      for (const game of expired) {
        if (!game.turnDeadlineAt || game.turnDeadlineAt > now || !game.currentTurnUserId) continue;
        const winnerUserId = opponentOf(game, game.currentTurnUserId);
        await tx
          .update(games)
          .set({
            status: "completed",
            endReason: "timeout",
            winnerUserId,
            currentTurnUserId: null,
            turnDeadlineAt: null,
            endedAt: now,
            stateVersion: game.stateVersion + 1,
          })
          .where(and(eq(games.id, game.id), eq(games.stateVersion, game.stateVersion)));
        settled.push({
          gameId: game.id,
          stateVersion: game.stateVersion + 1,
          deadline: game.turnDeadlineAt,
        });
      }
      return settled;
    });
  }

  async expireWaitingGames(limit = 50): Promise<ExpiredInvitation[]> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const expired = await tx
        .select()
        .from(games)
        .where(and(eq(games.status, "waiting"), sql`${games.inviteExpiresAt} <= ${now}`))
        .limit(limit)
        .for("update", { skipLocked: true });
      for (const game of expired) {
        await tx
          .update(games)
          .set({
            status: "expired",
            endReason: "expired",
            endedAt: now,
            stateVersion: game.stateVersion + 1,
          })
          .where(and(eq(games.id, game.id), eq(games.stateVersion, game.stateVersion)));
      }
      return expired.map((game) => ({
        gameId: game.id,
        stateVersion: game.stateVersion + 1,
        affectedUserIds: [game.hostUserId, game.invitedUserId].filter((value): value is string =>
          Boolean(value),
        ),
      }));
    });
  }
}

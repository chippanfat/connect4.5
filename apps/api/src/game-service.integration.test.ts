import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { games, user, createDatabase } from "@four/db";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppError } from "./errors";
import { GameService } from "./game-service";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("GameService with PostgreSQL", () => {
  if (!databaseUrl) return;
  const database = createDatabase(databaseUrl);
  const service = new GameService(database.db);
  const hostId = randomUUID();
  const guestId = randomUUID();
  const thirdId = randomUUID();

  beforeAll(async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    await migrate(database.db, {
      migrationsFolder: path.resolve(here, "../../../packages/db/drizzle"),
    });
  });

  beforeEach(async () => {
    await database.pool.query('TRUNCATE TABLE "user" CASCADE');
    await database.db.insert(user).values([
      {
        id: hostId,
        name: "Host",
        email: "host@test.local",
        emailVerified: true,
        username: "host",
        displayUsername: "Host",
      },
      {
        id: guestId,
        name: "Guest",
        email: "guest@test.local",
        emailVerified: true,
        username: "guest",
        displayUsername: "Guest",
      },
      {
        id: thirdId,
        name: "Third",
        email: "third@test.local",
        emailVerified: true,
        username: "third",
        displayUsername: "Third",
      },
    ]);
  });

  afterAll(async () => database.pool.end());

  it("serializes joins, moves, wins, history, and mutual rematches", async () => {
    const waiting = await service.createGame(hostId, 60);
    const [firstJoin, secondJoin] = await Promise.allSettled([
      service.joinGame(waiting.inviteCode!, guestId),
      service.joinGame(waiting.inviteCode!, thirdId),
    ]);
    expect(
      [firstJoin.status, secondJoin.status].filter((status) => status === "fulfilled"),
    ).toHaveLength(1);
    const active =
      firstJoin.status === "fulfilled"
        ? firstJoin.value
        : (secondJoin as PromiseFulfilledResult<typeof waiting>).value;
    const opponentId = active.players.find((player) => player.userId !== hostId)?.userId;
    expect(opponentId).toBeTruthy();
    const nonParticipantId = opponentId === guestId ? thirdId : guestId;

    let snapshot = active;
    const redId = snapshot.players.find((player) => player.color === "red")!.userId;
    const yellowId = snapshot.players.find((player) => player.color === "yellow")!.userId;
    for (const [playerId, column] of [
      [redId, 0],
      [yellowId, 6],
      [redId, 1],
      [yellowId, 6],
      [redId, 2],
      [yellowId, 5],
      [redId, 3],
    ] as const) {
      const result = await service.makeMove(playerId, {
        gameId: snapshot.id,
        commandId: randomUUID(),
        column,
        expectedVersion: snapshot.stateVersion,
      });
      snapshot = result.game;
    }
    expect(snapshot.endReason).toBe("connect_four");
    expect(snapshot.winnerUserId).toBe(redId);

    await expect(service.getSnapshot(snapshot.id, nonParticipantId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    } satisfies Partial<AppError>);
    expect((await service.listGames(hostId, "completed", undefined, 20)).items[0]?.id).toBe(
      snapshot.id,
    );

    const firstRequest = await service.requestRematch(hostId, {
      gameId: snapshot.id,
      commandId: randomUUID(),
      requested: true,
    });
    expect(firstRequest.nextGame).toBeNull();
    const secondPlayer = opponentId!;
    const secondRequest = await service.requestRematch(secondPlayer, {
      gameId: snapshot.id,
      commandId: randomUUID(),
      requested: true,
    });
    expect(secondRequest.nextGame?.status).toBe("active");
    expect(secondRequest.nextGame?.players.find((player) => player.color === "red")?.userId).toBe(
      snapshot.players.find((player) => player.color === "yellow")?.userId,
    );
  });

  it("settles elapsed clocks exactly once", async () => {
    const waiting = await service.createGame(hostId, 30);
    const active = await service.joinGame(waiting.inviteCode!, guestId);
    await database.db
      .update(games)
      .set({ turnDeadlineAt: new Date(Date.now() - 1000) })
      .where(eq(games.id, active.id));
    expect(await service.settleExpiredGames()).toHaveLength(1);
    expect(await service.settleExpiredGames()).toHaveLength(0);
    const finished = await service.getSnapshot(active.id, hostId);
    expect(finished.endReason).toBe("timeout");
    expect(finished.winnerUserId).not.toBe(finished.currentTurnUserId);
  });

  it("makes duplicate commands idempotent and rejects stale and out-of-turn moves", async () => {
    const waiting = await service.createGame(hostId, 60);
    const active = await service.joinGame(waiting.inviteCode!, guestId);
    const currentId = active.currentTurnUserId!;
    const otherId = active.players.find((player) => player.userId !== currentId)!.userId;
    const commandId = randomUUID();

    const firstMove = await service.makeMove(currentId, {
      gameId: active.id,
      commandId,
      column: 3,
      expectedVersion: active.stateVersion,
    });
    const duplicate = await service.makeMove(currentId, {
      gameId: active.id,
      commandId,
      column: 3,
      expectedVersion: active.stateVersion,
    });
    expect(duplicate.changed).toBe(false);
    expect(duplicate.game.moveCount).toBe(1);

    await expect(
      service.makeMove(otherId, {
        gameId: active.id,
        commandId: randomUUID(),
        column: 2,
        expectedVersion: active.stateVersion,
      }),
    ).rejects.toMatchObject({ code: "STALE_VERSION" } satisfies Partial<AppError>);
    await expect(
      service.makeMove(currentId, {
        gameId: active.id,
        commandId: randomUUID(),
        column: 2,
        expectedVersion: firstMove.game.stateVersion,
      }),
    ).rejects.toMatchObject({ code: "NOT_YOUR_TURN" } satisfies Partial<AppError>);

    const resignCommandId = randomUUID();
    const resigned = await service.resign(otherId, {
      gameId: active.id,
      commandId: resignCommandId,
    });
    expect(resigned.game.endReason).toBe("resignation");
    expect(resigned.game.winnerUserId).toBe(currentId);
    const duplicateResignation = await service.resign(otherId, {
      gameId: active.id,
      commandId: resignCommandId,
    });
    expect(duplicateResignation.changed).toBe(false);
    expect(duplicateResignation.game.endReason).toBe("resignation");
  });

  it("serializes competing moves and handles cancellation and invite expiry", async () => {
    const waiting = await service.createGame(hostId, 60);
    await expect(service.cancelGame(waiting.id, guestId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    } satisfies Partial<AppError>);
    expect((await service.cancelGame(waiting.id, hostId)).status).toBe("cancelled");

    const expiring = await service.createGame(hostId, 60);
    await database.db
      .update(games)
      .set({ inviteExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(games.id, expiring.id));
    expect((await service.getInvitePreview(expiring.inviteCode!)).status).toBe("expired");
    expect(await service.expireWaitingGames()).toHaveLength(1);
    expect(await service.expireWaitingGames()).toHaveLength(0);
    await expect(service.joinGame(expiring.inviteCode!, guestId)).rejects.toMatchObject({
      code: "INVITE_EXPIRED",
    } satisfies Partial<AppError>);
    expect((await service.getSnapshot(expiring.id, hostId)).status).toBe("expired");

    const raceWaiting = await service.createGame(hostId, 60);
    const raceGame = await service.joinGame(raceWaiting.inviteCode!, guestId);
    const moverId = raceGame.currentTurnUserId!;
    const outcomes = await Promise.allSettled([
      service.makeMove(moverId, {
        gameId: raceGame.id,
        commandId: randomUUID(),
        column: 0,
        expectedVersion: raceGame.stateVersion,
      }),
      service.makeMove(moverId, {
        gameId: raceGame.id,
        commandId: randomUUID(),
        column: 1,
        expectedVersion: raceGame.stateVersion,
      }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected).toMatchObject({ reason: { code: "STALE_VERSION" } });
    expect((await service.getSnapshot(raceGame.id, hostId)).moveCount).toBe(1);
  });
});

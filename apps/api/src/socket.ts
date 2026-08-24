import type {
  ClientToServerEvents,
  GameInvitationNotificationEvent,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "@four/contracts";
import {
  AccountSubscribeCommandSchema,
  MoveCommandSchema,
  RematchCommandSchema,
  ResignCommandSchema,
  SubscribeCommandSchema,
} from "@four/contracts";
import { createAdapter } from "@socket.io/redis-streams-adapter";
import { fromNodeHeaders } from "better-auth/node";
import type { Server as HttpServer } from "node:http";
import type { RedisClientType } from "redis";
import { Server } from "socket.io";

import type { Auth } from "./auth";
import type { AppConfig } from "./config";
import { AppError, failure } from "./errors";
import type { GameService } from "./game-service";
import type { AppLogger } from "./logger";
import type { Metrics } from "./metrics";
import type { SocialService } from "./social-service";

const roomName = (gameId: string) => `game:${gameId}`;
const accountRoomName = (userId: string) => `account:${userId}`;

interface SocketDependencies {
  auth: Auth;
  config: AppConfig;
  games: GameService;
  logger: AppLogger;
  metrics: Metrics;
  redis: RedisClientType;
  social: SocialService;
}

export async function createGameSocket(httpServer: HttpServer, dependencies: SocketDependencies) {
  const { auth, config, games, logger, metrics, redis, social } = dependencies;
  const adapterRedis = redis.duplicate();
  await adapterRedis.connect();

  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
    httpServer,
    {
      path: "/socket.io",
      cors: { origin: config.appOrigin, credentials: true },
      adapter: createAdapter(adapterRedis),
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: false,
      },
    },
  );
  const gameNamespace = io.of("/game");
  const accountNamespace = io.of("/account");

  const broadcastPresence = async (gameId: string) => {
    const connected = await gameNamespace.in(roomName(gameId)).fetchSockets();
    const connectedUserIds = [...new Set(connected.map((socket) => socket.data.userId))];
    gameNamespace.to(roomName(gameId)).emit("game:presence", { gameId, connectedUserIds });
  };

  const broadcastGame = async (gameId: string) => {
    try {
      const game = await games.getSnapshot(gameId, null);
      gameNamespace.to(roomName(gameId)).emit("game:state", game);
    } catch (error) {
      logger.error({ err: error, gameId }, "Unable to broadcast game state");
    }
  };

  const broadcastAccount = async (userId: string) => {
    try {
      const state = await social.getSnapshot(userId);
      accountNamespace.to(accountRoomName(userId)).emit("account:state", state);
    } catch (error) {
      logger.error({ err: error, userId }, "Unable to broadcast account state");
    }
  };

  const notifyGameInvitation = (inviteeUserId: string, event: GameInvitationNotificationEvent) => {
    accountNamespace.to(accountRoomName(inviteeUserId)).emit("account:game-invitation", event);
  };

  const enforceCommandRate = async (userId: string) => {
    const key = `rate:socket:${userId}:${Math.floor(Date.now() / 1000)}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 2);
    if (count > 12)
      throw new AppError("RATE_LIMITED", "Too many game actions. Slow down for a moment.");
  };

  const authenticateSocket: Parameters<typeof gameNamespace.use>[0] = async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      if (origin && origin !== config.appOrigin) {
        throw new AppError("FORBIDDEN", "This connection origin is not allowed.");
      }
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(socket.request.headers),
      });
      if (!session) throw new AppError("UNAUTHENTICATED", "Sign in to connect.");
      if (!session.user.emailVerified) {
        throw new AppError("EMAIL_NOT_VERIFIED", "Verify your email to play online.");
      }
      socket.data.userId = session.user.id;
      socket.data.username =
        session.user.displayUsername ?? session.user.username ?? session.user.name ?? "Player";
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error("Unable to authenticate the socket."));
    }
  };
  gameNamespace.use(authenticateSocket);
  accountNamespace.use(authenticateSocket);

  accountNamespace.on("connection", (socket) => {
    metrics.socketConnections.inc();
    void socket.join(accountRoomName(socket.data.userId));

    socket.on("account:subscribe", async (raw, ack) => {
      try {
        AccountSubscribeCommandSchema.parse(raw);
        const state = await social.getSnapshot(socket.data.userId);
        await socket.join(accountRoomName(socket.data.userId));
        ack({ ok: true, data: state });
      } catch (error) {
        ack(failure(error));
      }
    });

    socket.on("disconnect", () => {
      metrics.socketConnections.dec();
    });
  });

  gameNamespace.on("connection", (socket) => {
    metrics.socketConnections.inc();

    socket.on("game:subscribe", async (raw, ack) => {
      try {
        const command = SubscribeCommandSchema.parse(raw);
        const game = await games.getSnapshot(command.gameId, socket.data.userId);
        await socket.join(roomName(game.id));
        ack({ ok: true, data: game });
        await broadcastPresence(game.id);
      } catch (error) {
        ack(failure(error));
      }
    });

    socket.on("game:move", async (raw, ack) => {
      const stopTimer = metrics.moveLatency.startTimer();
      try {
        await enforceCommandRate(socket.data.userId);
        const command = MoveCommandSchema.parse(raw);
        const result = await games.makeMove(socket.data.userId, command);
        if (result.changed) {
          gameNamespace.to(roomName(result.game.id)).emit("game:state", result.game);
        }
        if (result.error) {
          metrics.gameCommands.inc({ command: "move", result: result.error.code });
          ack(failure(result.error));
        } else {
          metrics.gameCommands.inc({ command: "move", result: "ok" });
          ack({ ok: true, data: result.game });
        }
      } catch (error) {
        metrics.gameCommands.inc({
          command: "move",
          result: error instanceof AppError ? error.code : "error",
        });
        ack(failure(error));
      } finally {
        stopTimer();
      }
    });

    socket.on("game:resign", async (raw, ack) => {
      try {
        await enforceCommandRate(socket.data.userId);
        const command = ResignCommandSchema.parse(raw);
        const result = await games.resign(socket.data.userId, command);
        gameNamespace.to(roomName(result.game.id)).emit("game:state", result.game);
        metrics.gameCommands.inc({ command: "resign", result: "ok" });
        ack({ ok: true, data: result.game });
      } catch (error) {
        metrics.gameCommands.inc({
          command: "resign",
          result: error instanceof AppError ? error.code : "error",
        });
        ack(failure(error));
      }
    });

    socket.on("game:rematch-request", async (raw, ack) => {
      try {
        await enforceCommandRate(socket.data.userId);
        const command = RematchCommandSchema.parse(raw);
        const result = await games.requestRematch(socket.data.userId, command);
        gameNamespace.to(roomName(result.game.id)).emit("game:state", result.game);
        if (result.changed && command.requested && !result.nextGame) {
          const requestedBy = result.game.players.find(
            (player) => player.userId === socket.data.userId,
          );
          const opponent = result.game.players.find(
            (player) => player.userId !== socket.data.userId,
          );
          if (requestedBy && opponent) {
            accountNamespace
              .to(accountRoomName(opponent.userId))
              .emit("account:rematch-requested", {
                gameId: result.game.id,
                requestedBy: {
                  userId: requestedBy.userId,
                  username: requestedBy.username,
                },
              });
          }
        }
        if (result.nextGame) {
          gameNamespace.to(roomName(result.game.id)).emit("game:rematch-created", {
            previousGameId: result.game.id,
            game: result.nextGame,
          });
        }
        metrics.gameCommands.inc({ command: "rematch", result: "ok" });
        ack({ ok: true, data: { game: result.game, nextGame: result.nextGame } });
      } catch (error) {
        metrics.gameCommands.inc({
          command: "rematch",
          result: error instanceof AppError ? error.code : "error",
        });
        ack(failure(error));
      }
    });

    socket.on("disconnecting", () => {
      const gameIds = [...socket.rooms]
        .filter((room) => room.startsWith("game:"))
        .map((room) => room.slice(5));
      setTimeout(() => {
        for (const gameId of gameIds) void broadcastPresence(gameId);
      }, 50);
    });

    socket.on("disconnect", () => {
      metrics.socketConnections.dec();
    });
  });

  return {
    io,
    broadcastGame,
    broadcastAccount,
    notifyGameInvitation,
    close: async () => {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await adapterRedis.quit();
    },
  };
}

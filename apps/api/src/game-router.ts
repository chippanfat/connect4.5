import { CreateGameInputSchema, GameListQuerySchema } from "@four/contracts";
import { Router } from "express";
import { z } from "zod";

import type { Auth } from "./auth";
import type { AppConfig } from "./config";
import { AppError } from "./errors";
import type { GameService } from "./game-service";
import { currentUser, requireAuth } from "./session";

const IdParamsSchema = z.object({ id: z.string().uuid() });
const InviteParamsSchema = z.object({ code: z.string().min(16).max(32) });

interface RouterDependencies {
  auth: Auth;
  config: AppConfig;
  games: GameService;
  broadcastGame: (gameId: string) => Promise<void>;
  broadcastAccount: (userId: string) => Promise<void>;
}

export function createGameRouter({
  auth,
  config,
  games,
  broadcastGame,
  broadcastAccount,
}: RouterDependencies) {
  const router = Router();

  const publishExpiredInvitation = async (gameId: string, error: unknown) => {
    if (!(error instanceof AppError) || error.code !== "INVITE_EXPIRED") return;
    const game = await games.getSnapshot(gameId, null);
    await Promise.all([
      broadcastGame(game.id),
      broadcastAccount(game.hostUserId),
      ...(game.pendingInvitee ? [broadcastAccount(game.pendingInvitee.userId)] : []),
    ]);
  };

  router.get("/invites/:code", async (request, response) => {
    const { code } = InviteParamsSchema.parse(request.params);
    response.json({ ok: true, data: await games.getInvitePreview(code) });
  });

  router.use(requireAuth(auth));

  router.post("/games", async (request, response) => {
    const input = CreateGameInputSchema.parse(request.body);
    const userId = currentUser(response).id;
    const game = await games.createGame(userId, input.turnSeconds, input.invitation);
    if (game.pendingInvitee) {
      await Promise.all([broadcastAccount(userId), broadcastAccount(game.pendingInvitee.userId)]);
    }
    response.status(201).json({
      ok: true,
      data: {
        game,
        inviteUrl: game.inviteCode ? `${config.appOrigin}/join/${game.inviteCode}` : null,
      },
    });
  });

  router.post("/invites/:code/join", async (request, response) => {
    const { code } = InviteParamsSchema.parse(request.params);
    const game = await games.joinGame(code, currentUser(response).id);
    await broadcastGame(game.id);
    response.json({ ok: true, data: game });
  });

  router.get("/games", async (request, response) => {
    const query = GameListQuerySchema.parse(request.query);
    response.json({
      ok: true,
      data: await games.listGames(
        currentUser(response).id,
        query.status,
        query.cursor,
        query.limit,
      ),
    });
  });

  router.get("/games/:id", async (request, response) => {
    const { id } = IdParamsSchema.parse(request.params);
    response.json({ ok: true, data: await games.getSnapshot(id, currentUser(response).id) });
  });

  router.delete("/games/:id", async (request, response) => {
    const { id } = IdParamsSchema.parse(request.params);
    const game = await games.cancelGame(id, currentUser(response).id);
    await broadcastGame(game.id);
    await Promise.all(
      [game.hostUserId, game.pendingInvitee?.userId]
        .filter((userId): userId is string => Boolean(userId))
        .map(broadcastAccount),
    );
    response.json({ ok: true, data: game });
  });

  router.post("/game-invitations/:id/accept", async (request, response) => {
    const { id } = IdParamsSchema.parse(request.params);
    const userId = currentUser(response).id;
    try {
      const game = await games.acceptGameInvitation(id, userId);
      await Promise.all([
        broadcastGame(game.id),
        broadcastAccount(game.hostUserId),
        broadcastAccount(userId),
      ]);
      response.json({ ok: true, data: game });
    } catch (error) {
      await publishExpiredInvitation(id, error);
      throw error;
    }
  });

  router.post("/game-invitations/:id/decline", async (request, response) => {
    const { id } = IdParamsSchema.parse(request.params);
    const userId = currentUser(response).id;
    try {
      const game = await games.declineGameInvitation(id, userId);
      await Promise.all([
        broadcastGame(game.id),
        broadcastAccount(game.hostUserId),
        broadcastAccount(userId),
      ]);
      response.json({ ok: true, data: { gameId: game.id, status: game.status } });
    } catch (error) {
      await publishExpiredInvitation(id, error);
      throw error;
    }
  });

  return router;
}

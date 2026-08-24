import { CreateGameInputSchema, GameListQuerySchema } from "@four/contracts";
import { Router } from "express";
import { z } from "zod";

import type { Auth } from "./auth";
import type { AppConfig } from "./config";
import type { GameService } from "./game-service";
import { currentUser, requireAuth } from "./session";

const IdParamsSchema = z.object({ id: z.string().uuid() });
const InviteParamsSchema = z.object({ code: z.string().min(16).max(32) });

interface RouterDependencies {
  auth: Auth;
  config: AppConfig;
  games: GameService;
  broadcastGame: (gameId: string) => Promise<void>;
}

export function createGameRouter({ auth, config, games, broadcastGame }: RouterDependencies) {
  const router = Router();

  router.get("/invites/:code", async (request, response) => {
    const { code } = InviteParamsSchema.parse(request.params);
    response.json({ ok: true, data: await games.getInvitePreview(code) });
  });

  router.use(requireAuth(auth));

  router.post("/games", async (request, response) => {
    const input = CreateGameInputSchema.parse(request.body);
    const game = await games.createGame(currentUser(response).id, input.turnSeconds);
    response.status(201).json({
      ok: true,
      data: { game, inviteUrl: `${config.appOrigin}/join/${game.inviteCode}` },
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
    response.json({ ok: true, data: game });
  });

  return router;
}

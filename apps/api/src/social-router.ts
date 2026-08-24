import { CreateFriendRequestInputSchema, UsernameSearchQuerySchema } from "@four/contracts";
import { Router } from "express";
import { z } from "zod";

import type { Auth } from "./auth";
import type { EmailMessage } from "./email";
import { currentUser, requireAuth } from "./session";
import type { SocialMutationResult, SocialService } from "./social-service";

const IdParamsSchema = z.object({ id: z.string().uuid() });
const UserParamsSchema = z.object({ userId: z.string().min(1).max(128) });

interface SocialRouterDependencies {
  auth: Auth;
  social: SocialService;
  appOrigin: string;
  sendEmail: (message: EmailMessage) => Promise<void>;
  broadcastAccount: (userId: string) => Promise<void>;
  broadcastGame: (gameId: string) => Promise<void>;
}

export function createSocialRouter({
  auth,
  social,
  appOrigin,
  sendEmail,
  broadcastAccount,
  broadcastGame,
}: SocialRouterDependencies) {
  const router = Router();
  router.use(requireAuth(auth));

  const publishMutation = async (mutation: SocialMutationResult) => {
    await Promise.all([
      ...mutation.affectedUserIds.map(broadcastAccount),
      ...mutation.cancelledGameIds.map(broadcastGame),
    ]);
  };

  router.get("/social", async (_request, response) => {
    response.json({
      ok: true,
      data: await social.getSnapshot(currentUser(response).id),
    });
  });

  router.get("/users/search", async (request, response) => {
    const query = UsernameSearchQuerySchema.parse(request.query);
    response.json({
      ok: true,
      data: await social.searchUsername(currentUser(response).id, query.username),
    });
  });

  router.post("/friend-requests", async (request, response) => {
    const input = CreateFriendRequestInputSchema.parse(request.body);
    const userId = currentUser(response).id;
    const mutation = await social.sendFriendRequest(userId, input.username);
    await Promise.all([
      publishMutation(mutation),
      mutation.friendRequestEmail
        ? sendEmail({
            kind: "friend-request",
            to: mutation.friendRequestEmail.to,
            username: mutation.friendRequestEmail.recipientUsername,
            requesterUsername: mutation.friendRequestEmail.requesterUsername,
            friendsUrl: `${appOrigin}/friends`,
          })
        : Promise.resolve(),
    ]);
    response.status(201).json({ ok: true, data: await social.getSnapshot(userId) });
  });

  router.post("/friend-requests/:id/accept", async (request, response) => {
    const { id } = IdParamsSchema.parse(request.params);
    const userId = currentUser(response).id;
    const mutation = await social.acceptFriendRequest(id, userId);
    await publishMutation(mutation);
    response.json({ ok: true, data: await social.getSnapshot(userId) });
  });

  router.post("/friend-requests/:id/decline", async (request, response) => {
    const { id } = IdParamsSchema.parse(request.params);
    const userId = currentUser(response).id;
    const mutation = await social.declineFriendRequest(id, userId);
    await publishMutation(mutation);
    response.json({ ok: true, data: await social.getSnapshot(userId) });
  });

  router.delete("/friend-requests/:id", async (request, response) => {
    const { id } = IdParamsSchema.parse(request.params);
    const userId = currentUser(response).id;
    const mutation = await social.cancelFriendRequest(id, userId);
    await publishMutation(mutation);
    response.json({ ok: true, data: await social.getSnapshot(userId) });
  });

  router.delete("/friends/:userId", async (request, response) => {
    const { userId: friendUserId } = UserParamsSchema.parse(request.params);
    const userId = currentUser(response).id;
    const mutation = await social.removeFriend(friendUserId, userId);
    await publishMutation(mutation);
    response.json({ ok: true, data: await social.getSnapshot(userId) });
  });

  return router;
}

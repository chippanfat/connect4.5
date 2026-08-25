import { PushSubscriptionInputSchema } from "@four/contracts";
import { Router } from "express";

import type { Auth } from "./auth";
import { AppError } from "./errors";
import type { PushService } from "./push-service";
import { currentUser, requireAuth } from "./session";

interface PushRouterDependencies {
  auth: Auth;
  push: PushService;
}

export function createPushRouter({ auth, push }: PushRouterDependencies) {
  const router = Router();
  router.use(requireAuth(auth));

  router.get("/push/config", (_request, response) => {
    response.json({
      ok: true,
      data: { enabled: push.enabled, publicKey: push.publicKey },
    });
  });

  router.post("/push/subscriptions", async (request, response) => {
    if (!push.enabled) {
      throw new AppError("INTERNAL_ERROR", "Push notifications are not configured.", {
        status: 503,
      });
    }
    const subscription = PushSubscriptionInputSchema.parse(request.body);
    await push.saveSubscription(currentUser(response).id, subscription);
    response.status(201).json({ ok: true, data: { subscribed: true } });
  });

  router.delete("/push/subscriptions", async (request, response) => {
    const subscription = PushSubscriptionInputSchema.pick({ endpoint: true }).parse(request.body);
    await push.removeSubscription(currentUser(response).id, subscription.endpoint);
    response.json({ ok: true, data: { subscribed: false } });
  });

  return router;
}

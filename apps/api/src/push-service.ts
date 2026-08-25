import type { PushSubscriptionInput } from "@four/contracts";
import { pushSubscriptions, type Database } from "@four/db";
import { and, eq } from "drizzle-orm";
import webpush, { WebPushError } from "web-push";

import type { AppConfig } from "./config";
import type { AppLogger } from "./logger";

export interface WebPushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
}

type SendNotification = typeof webpush.sendNotification;

export class PushService {
  readonly enabled: boolean;
  readonly publicKey: string | null;

  private readonly vapidDetails: {
    subject: string;
    publicKey: string;
    privateKey: string;
  } | null;

  constructor(
    private readonly db: Database,
    config: AppConfig,
    private readonly logger: AppLogger,
    private readonly sendNotification: SendNotification = webpush.sendNotification,
  ) {
    this.vapidDetails =
      config.push.enabled && config.push.publicKey && config.push.privateKey
        ? {
            subject: config.push.subject,
            publicKey: config.push.publicKey,
            privateKey: config.push.privateKey,
          }
        : null;
    this.enabled = this.vapidDetails !== null;
    this.publicKey = this.vapidDetails?.publicKey ?? null;
  }

  async saveSubscription(userId: string, subscription: PushSubscriptionInput) {
    if (!this.enabled) return false;
    await this.db
      .insert(pushSubscriptions)
      .values({
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          updatedAt: new Date(),
        },
      });
    return true;
  }

  async removeSubscription(userId: string, endpoint: string) {
    await this.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
  }

  async sendToUser(userId: string, payload: WebPushPayload) {
    if (!this.vapidDetails) return;
    try {
      const subscriptions = await this.db
        .select({
          endpoint: pushSubscriptions.endpoint,
          p256dh: pushSubscriptions.p256dh,
          auth: pushSubscriptions.auth,
        })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId));

      await Promise.all(
        subscriptions.map(async (subscription) => {
          try {
            await this.sendNotification(
              {
                endpoint: subscription.endpoint,
                keys: { p256dh: subscription.p256dh, auth: subscription.auth },
              },
              JSON.stringify(payload),
              {
                TTL: 24 * 60 * 60,
                urgency: "high",
                vapidDetails: this.vapidDetails!,
              },
            );
          } catch (error) {
            if (error instanceof WebPushError && [404, 410].includes(error.statusCode)) {
              await this.db
                .delete(pushSubscriptions)
                .where(eq(pushSubscriptions.endpoint, subscription.endpoint));
              return;
            }
            this.logger.warn(
              { err: error, userId, notificationTag: payload.tag },
              "Unable to deliver a web push notification",
            );
          }
        }),
      );
    } catch (error) {
      this.logger.error(
        { err: error, userId, notificationTag: payload.tag },
        "Unable to load web push subscriptions",
      );
    }
  }
}

import type {
  FriendRelationship,
  SocialSnapshot,
  TurnSeconds,
  UserSearchResult,
} from "@four/contracts";
import { friendships, games, user, type Database } from "@four/db";
import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";

import { AppError } from "./errors";

function canonicalPair(firstUserId: string, secondUserId: string) {
  return firstUserId < secondUserId
    ? { userAId: firstUserId, userBId: secondUserId }
    : { userAId: secondUserId, userBId: firstUserId };
}

function otherUserId(relationship: { userAId: string; userBId: string }, currentUserId: string) {
  return relationship.userAId === currentUserId ? relationship.userBId : relationship.userAId;
}

function publicUser(account: {
  id: string;
  name: string;
  username: string | null;
  displayUsername: string | null;
}) {
  return {
    userId: account.id,
    username: account.displayUsername ?? account.username ?? account.name,
  };
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

export interface SocialMutationResult {
  affectedUserIds: string[];
  cancelledGameIds: string[];
}

export class SocialService {
  constructor(private readonly db: Database) {}

  async getSnapshot(userId: string): Promise<SocialSnapshot> {
    const now = new Date();
    const [relationshipRows, invitationRows] = await Promise.all([
      this.db
        .select()
        .from(friendships)
        .where(
          and(
            or(eq(friendships.userAId, userId), eq(friendships.userBId, userId)),
            inArray(friendships.status, ["pending", "accepted"]),
          ),
        )
        .orderBy(desc(friendships.createdAt)),
      this.db
        .select()
        .from(games)
        .where(
          and(
            eq(games.status, "waiting"),
            gt(games.inviteExpiresAt, now),
            or(eq(games.hostUserId, userId), eq(games.invitedUserId, userId)),
          ),
        )
        .orderBy(desc(games.createdAt)),
    ]);

    const userIds = new Set<string>([userId]);
    for (const relationship of relationshipRows) {
      userIds.add(relationship.userAId);
      userIds.add(relationship.userBId);
    }
    for (const game of invitationRows) {
      userIds.add(game.hostUserId);
      if (game.invitedUserId) userIds.add(game.invitedUserId);
    }
    const accounts = await this.db
      .select()
      .from(user)
      .where(inArray(user.id, [...userIds]));
    const usersById = new Map(accounts.map((account) => [account.id, publicUser(account)]));
    const getUser = (id: string) => {
      const account = usersById.get(id);
      if (!account) throw new AppError("INTERNAL_ERROR", "A social profile could not be loaded.");
      return account;
    };

    const friends = relationshipRows
      .filter((relationship) => relationship.status === "accepted")
      .map((relationship) => ({
        relationshipId: relationship.id,
        user: getUser(otherUserId(relationship, userId)),
        friendsSince: (relationship.decidedAt ?? relationship.updatedAt).toISOString(),
      }));
    const pending = relationshipRows.filter((relationship) => relationship.status === "pending");
    const request = (relationship: (typeof pending)[number]) => ({
      id: relationship.id,
      user: getUser(otherUserId(relationship, userId)),
      createdAt: relationship.createdAt.toISOString(),
    });
    const invitations = invitationRows
      .filter((game) => game.invitedUserId)
      .map((game) => ({
        gameId: game.id,
        host: getUser(game.hostUserId),
        invitee: getUser(game.invitedUserId!),
        turnSeconds: game.turnSeconds as TurnSeconds,
        createdAt: game.createdAt.toISOString(),
        expiresAt: game.inviteExpiresAt.toISOString(),
      }));

    return {
      friends,
      incomingFriendRequests: pending
        .filter((relationship) => relationship.requestedByUserId !== userId)
        .map(request),
      outgoingFriendRequests: pending
        .filter((relationship) => relationship.requestedByUserId === userId)
        .map(request),
      incomingGameInvitations: invitations.filter(
        (invitation) => invitation.invitee.userId === userId,
      ),
      outgoingGameInvitations: invitations.filter(
        (invitation) => invitation.host.userId === userId,
      ),
      serverTime: now.toISOString(),
    };
  }

  async searchUsername(currentUserId: string, rawUsername: string): Promise<UserSearchResult> {
    const [target] = await this.db
      .select()
      .from(user)
      .where(and(eq(user.username, rawUsername.toLowerCase()), eq(user.emailVerified, true)))
      .limit(1);
    if (!target) throw new AppError("USER_NOT_FOUND", "No verified player has that username.");
    if (target.id === currentUserId) {
      throw new AppError("CANNOT_ADD_SELF", "You cannot add yourself as a friend.");
    }

    const pair = canonicalPair(currentUserId, target.id);
    const [relationship] = await this.db
      .select()
      .from(friendships)
      .where(and(eq(friendships.userAId, pair.userAId), eq(friendships.userBId, pair.userBId)))
      .limit(1);
    let relation: FriendRelationship = "none";
    let canSendRequest = true;
    if (relationship?.status === "accepted") {
      relation = "friends";
      canSendRequest = false;
    } else if (relationship?.status === "pending") {
      relation =
        relationship.requestedByUserId === currentUserId ? "outgoing_request" : "incoming_request";
      canSendRequest = false;
    } else if (relationship?.status === "closed") {
      if (relationship.closedByUserId !== currentUserId) {
        relation = "unavailable";
        canSendRequest = false;
      }
    }
    return { user: publicUser(target), relationship: relation, canSendRequest };
  }

  async sendFriendRequest(
    currentUserId: string,
    rawUsername: string,
  ): Promise<SocialMutationResult> {
    const [target] = await this.db
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.username, rawUsername.toLowerCase()), eq(user.emailVerified, true)))
      .limit(1);
    if (!target) throw new AppError("USER_NOT_FOUND", "No verified player has that username.");
    if (target.id === currentUserId) {
      throw new AppError("CANNOT_ADD_SELF", "You cannot add yourself as a friend.");
    }
    const pair = canonicalPair(currentUserId, target.id);
    try {
      await this.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(friendships)
          .where(and(eq(friendships.userAId, pair.userAId), eq(friendships.userBId, pair.userBId)))
          .limit(1)
          .for("update");
        if (!existing) {
          await tx.insert(friendships).values({
            ...pair,
            requestedByUserId: currentUserId,
          });
          return;
        }
        if (existing.status === "accepted") {
          throw new AppError("ALREADY_FRIENDS", "You are already friends.");
        }
        if (existing.status === "pending") {
          throw new AppError("FRIEND_REQUEST_EXISTS", "A friend request already exists.");
        }
        if (existing.closedByUserId !== currentUserId) {
          throw new AppError("RELATIONSHIP_CLOSED", "This player is not available to add.");
        }
        const now = new Date();
        await tx
          .update(friendships)
          .set({
            status: "pending",
            requestedByUserId: currentUserId,
            closedByUserId: null,
            decidedAt: null,
            createdAt: now,
            updatedAt: now,
          })
          .where(eq(friendships.id, existing.id));
      });
    } catch (error) {
      if (isUniqueViolation(error, "friendships_pair_unique")) {
        throw new AppError("FRIEND_REQUEST_EXISTS", "A friend request already exists.");
      }
      throw error;
    }
    return { affectedUserIds: [currentUserId, target.id], cancelledGameIds: [] };
  }

  async acceptFriendRequest(requestId: string, currentUserId: string) {
    return this.decideFriendRequest(requestId, currentUserId, "accepted");
  }

  async declineFriendRequest(requestId: string, currentUserId: string) {
    return this.decideFriendRequest(requestId, currentUserId, "closed");
  }

  private async decideFriendRequest(
    requestId: string,
    currentUserId: string,
    decision: "accepted" | "closed",
  ): Promise<SocialMutationResult> {
    const affectedUserIds = await this.db.transaction(async (tx) => {
      const [relationship] = await tx
        .select()
        .from(friendships)
        .where(eq(friendships.id, requestId))
        .limit(1)
        .for("update");
      if (!relationship || ![relationship.userAId, relationship.userBId].includes(currentUserId)) {
        throw new AppError("FORBIDDEN", "This friend request is not available.");
      }
      if (relationship.status === decision) {
        if (decision === "accepted" || relationship.closedByUserId === currentUserId) {
          return [relationship.userAId, relationship.userBId];
        }
      }
      if (relationship.status !== "pending" || relationship.requestedByUserId === currentUserId) {
        throw new AppError("FORBIDDEN", "Only the recipient can respond to this request.");
      }
      const now = new Date();
      await tx
        .update(friendships)
        .set({
          status: decision,
          closedByUserId: decision === "closed" ? currentUserId : null,
          decidedAt: now,
          updatedAt: now,
        })
        .where(eq(friendships.id, relationship.id));
      return [relationship.userAId, relationship.userBId];
    });
    return { affectedUserIds, cancelledGameIds: [] };
  }

  async cancelFriendRequest(
    requestId: string,
    currentUserId: string,
  ): Promise<SocialMutationResult> {
    const affectedUserIds = await this.db.transaction(async (tx) => {
      const [relationship] = await tx
        .select()
        .from(friendships)
        .where(eq(friendships.id, requestId))
        .limit(1)
        .for("update");
      if (!relationship || relationship.requestedByUserId !== currentUserId) {
        throw new AppError("FORBIDDEN", "Only the sender can cancel this request.");
      }
      if (relationship.status !== "pending") {
        throw new AppError("FRIEND_REQUEST_EXISTS", "This request is no longer pending.");
      }
      await tx.delete(friendships).where(eq(friendships.id, relationship.id));
      return [relationship.userAId, relationship.userBId];
    });
    return { affectedUserIds, cancelledGameIds: [] };
  }

  async removeFriend(friendUserId: string, currentUserId: string): Promise<SocialMutationResult> {
    if (friendUserId === currentUserId) {
      throw new AppError("CANNOT_ADD_SELF", "You cannot remove yourself.");
    }
    const pair = canonicalPair(currentUserId, friendUserId);
    return this.db.transaction(async (tx) => {
      const [relationship] = await tx
        .select()
        .from(friendships)
        .where(and(eq(friendships.userAId, pair.userAId), eq(friendships.userBId, pair.userBId)))
        .limit(1)
        .for("update");
      if (!relationship || relationship.status !== "accepted") {
        throw new AppError("FRIENDSHIP_REQUIRED", "This player is not an accepted friend.");
      }
      const now = new Date();
      await tx
        .update(friendships)
        .set({ status: "closed", closedByUserId: currentUserId, decidedAt: now, updatedAt: now })
        .where(eq(friendships.id, relationship.id));

      const cancelled = await tx
        .update(games)
        .set({
          status: "cancelled",
          endReason: "cancelled",
          endedAt: now,
          turnDeadlineAt: null,
          stateVersion: sql`${games.stateVersion} + 1`,
        })
        .where(
          and(
            eq(games.status, "waiting"),
            or(
              and(eq(games.hostUserId, currentUserId), eq(games.invitedUserId, friendUserId)),
              and(eq(games.hostUserId, friendUserId), eq(games.invitedUserId, currentUserId)),
            ),
          ),
        )
        .returning({ id: games.id });
      return {
        affectedUserIds: [currentUserId, friendUserId],
        cancelledGameIds: cancelled.map((game) => game.id),
      };
    });
  }
}

import type { Board, Coordinate } from "@four/game-engine";
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    username: varchar("username", { length: 20 }),
    displayUsername: varchar("display_username", { length: 20 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("user_email_idx").on(table.email),
    uniqueIndex("user_username_idx").on(table.username),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("session_token_idx").on(table.token),
    index("session_user_id_idx").on(table.userId),
  ],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (table) => [
    index("account_user_id_idx").on(table.userId),
    unique("account_issuer_account_unique").on(table.issuer, table.accountId),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("push_subscriptions_endpoint_idx").on(table.endpoint),
    index("push_subscriptions_user_id_idx").on(table.userId),
  ],
);

export const gameStatusEnum = pgEnum("game_status", [
  "waiting",
  "active",
  "completed",
  "cancelled",
  "expired",
]);
export const gameEndReasonEnum = pgEnum("game_end_reason", [
  "connect_four",
  "draw",
  "resignation",
  "timeout",
  "cancelled",
  "declined",
  "expired",
]);

export const friendshipStatusEnum = pgEnum("friendship_status", ["pending", "accepted", "closed"]);

export const friendships = pgTable(
  "friendships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userAId: text("user_a_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    userBId: text("user_b_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: friendshipStatusEnum("status").default("pending").notNull(),
    requestedByUserId: text("requested_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    closedByUserId: text("closed_by_user_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("friendships_pair_unique").on(table.userAId, table.userBId),
    index("friendships_user_a_idx").on(table.userAId, table.status),
    index("friendships_user_b_idx").on(table.userBId, table.status),
    check("friendships_pair_order_check", sql`${table.userAId} < ${table.userBId}`),
    check(
      "friendships_requester_member_check",
      sql`${table.requestedByUserId} in (${table.userAId}, ${table.userBId})`,
    ),
    check(
      "friendships_closer_member_check",
      sql`${table.closedByUserId} is null or ${table.closedByUserId} in (${table.userAId}, ${table.userBId})`,
    ),
  ],
);

export const games = pgTable(
  "games",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    seriesId: uuid("series_id").notNull(),
    rematchOfId: uuid("rematch_of_id").references((): AnyPgColumn => games.id, {
      onDelete: "set null",
    }),
    inviteCode: varchar("invite_code", { length: 32 }),
    inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }).notNull(),
    status: gameStatusEnum("status").default("waiting").notNull(),
    endReason: gameEndReasonEnum("end_reason"),
    hostUserId: text("host_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    guestUserId: text("guest_user_id").references(() => user.id, { onDelete: "restrict" }),
    invitedUserId: text("invited_user_id").references(() => user.id, { onDelete: "restrict" }),
    redUserId: text("red_user_id").references(() => user.id, { onDelete: "restrict" }),
    yellowUserId: text("yellow_user_id").references(() => user.id, { onDelete: "restrict" }),
    currentTurnUserId: text("current_turn_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    winnerUserId: text("winner_user_id").references(() => user.id, { onDelete: "restrict" }),
    endCommandId: uuid("end_command_id"),
    board: jsonb("board").$type<Board>().notNull(),
    winningCells: jsonb("winning_cells")
      .$type<Coordinate[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    moveCount: integer("move_count").default(0).notNull(),
    stateVersion: integer("state_version").default(0).notNull(),
    turnSeconds: integer("turn_seconds").notNull(),
    turnDeadlineAt: timestamp("turn_deadline_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("games_invite_code_idx").on(table.inviteCode),
    index("games_active_deadline_idx").on(table.status, table.turnDeadlineAt),
    index("games_host_history_idx").on(table.hostUserId, table.createdAt),
    index("games_guest_history_idx").on(table.guestUserId, table.createdAt),
    index("games_invited_user_idx").on(table.invitedUserId, table.status, table.createdAt),
    uniqueIndex("games_pending_friend_pair_idx")
      .on(
        sql`least(${table.hostUserId}, ${table.invitedUserId})`,
        sql`greatest(${table.hostUserId}, ${table.invitedUserId})`,
      )
      .where(sql`${table.status} = 'waiting' and ${table.invitedUserId} is not null`),
    index("games_series_idx").on(table.seriesId, table.createdAt),
    check("games_turn_seconds_check", sql`${table.turnSeconds} in (30, 60, 120)`),
    check("games_move_count_check", sql`${table.moveCount} between 0 and 42`),
    check(
      "games_players_distinct_check",
      sql`${table.guestUserId} is null or ${table.guestUserId} <> ${table.hostUserId}`,
    ),
    check(
      "games_invited_user_distinct_check",
      sql`${table.invitedUserId} is null or ${table.invitedUserId} <> ${table.hostUserId}`,
    ),
    check(
      "games_invitation_kind_check",
      sql`(${table.invitedUserId} is null and ${table.inviteCode} is not null) or (${table.invitedUserId} is not null and ${table.inviteCode} is null)`,
    ),
  ],
);

export const gameMoves = pgTable(
  "game_moves",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    playerId: text("player_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    commandId: uuid("command_id").notNull(),
    sequence: integer("sequence").notNull(),
    column: integer("column").notNull(),
    row: integer("row").notNull(),
    color: varchar("color", { length: 6 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("game_moves_sequence_unique").on(table.gameId, table.sequence),
    unique("game_moves_command_unique").on(table.gameId, table.playerId, table.commandId),
    index("game_moves_game_idx").on(table.gameId, table.sequence),
    check("game_moves_column_check", sql`${table.column} between 0 and 6`),
    check("game_moves_row_check", sql`${table.row} between 0 and 5`),
    check("game_moves_color_check", sql`${table.color} in ('red', 'yellow')`),
  ],
);

export const rematchRequests = pgTable(
  "rematch_requests",
  {
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    commandId: uuid("command_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.userId] }),
    unique("rematch_command_unique").on(table.gameId, table.userId, table.commandId),
  ],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  pushSubscriptions: many(pushSubscriptions),
  friendshipsAsA: many(friendships, { relationName: "friendshipUserA" }),
  friendshipsAsB: many(friendships, { relationName: "friendshipUserB" }),
}));

export const friendshipRelations = relations(friendships, ({ one }) => ({
  userA: one(user, {
    fields: [friendships.userAId],
    references: [user.id],
    relationName: "friendshipUserA",
  }),
  userB: one(user, {
    fields: [friendships.userBId],
    references: [user.id],
    relationName: "friendshipUserB",
  }),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] }),
}));

export const pushSubscriptionRelations = relations(pushSubscriptions, ({ one }) => ({
  user: one(user, { fields: [pushSubscriptions.userId], references: [user.id] }),
}));

export const gameRelations = relations(games, ({ many, one }) => ({
  host: one(user, { fields: [games.hostUserId], references: [user.id], relationName: "gameHost" }),
  guest: one(user, {
    fields: [games.guestUserId],
    references: [user.id],
    relationName: "gameGuest",
  }),
  moves: many(gameMoves),
  rematchRequests: many(rematchRequests),
  previousGame: one(games, {
    fields: [games.rematchOfId],
    references: [games.id],
    relationName: "rematches",
  }),
  rematches: many(games, { relationName: "rematches" }),
}));

export const moveRelations = relations(gameMoves, ({ one }) => ({
  game: one(games, { fields: [gameMoves.gameId], references: [games.id] }),
  player: one(user, { fields: [gameMoves.playerId], references: [user.id] }),
}));

export const rematchRequestRelations = relations(rematchRequests, ({ one }) => ({
  game: one(games, { fields: [rematchRequests.gameId], references: [games.id] }),
  player: one(user, { fields: [rematchRequests.userId], references: [user.id] }),
}));

export const schema = {
  user,
  session,
  account,
  verification,
  pushSubscriptions,
  friendships,
  games,
  gameMoves,
  rematchRequests,
  userRelations,
  sessionRelations,
  accountRelations,
  pushSubscriptionRelations,
  friendshipRelations,
  gameRelations,
  moveRelations,
  rematchRequestRelations,
};

export type GameRow = typeof games.$inferSelect;
export type NewGameRow = typeof games.$inferInsert;
export type UserRow = typeof user.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

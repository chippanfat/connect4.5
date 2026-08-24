import { z } from "zod";

export const DiscColorSchema = z.enum(["red", "yellow"]);
export type DiscColor = z.infer<typeof DiscColorSchema>;

export const CellSchema = DiscColorSchema.nullable();
export const BoardSchema = z.array(z.array(CellSchema).length(7)).length(6);
export type Board = z.infer<typeof BoardSchema>;

export const GameStatusSchema = z.enum(["waiting", "active", "completed", "cancelled", "expired"]);
export type GameStatus = z.infer<typeof GameStatusSchema>;

export const GameEndReasonSchema = z
  .enum(["connect_four", "draw", "resignation", "timeout", "cancelled", "expired"])
  .nullable();
export type GameEndReason = z.infer<typeof GameEndReasonSchema>;

export const TurnSecondsSchema = z.union([z.literal(30), z.literal(60), z.literal(120)]);
export type TurnSeconds = z.infer<typeof TurnSecondsSchema>;

export const PublicPlayerSchema = z.object({
  userId: z.string(),
  username: z.string(),
  color: DiscColorSchema.nullable(),
});
export type PublicPlayer = z.infer<typeof PublicPlayerSchema>;

export const CoordinateSchema = z.object({
  row: z.number().int().min(0).max(5),
  column: z.number().int().min(0).max(6),
});
export type Coordinate = z.infer<typeof CoordinateSchema>;

export const LastMoveSchema = CoordinateSchema.extend({
  color: DiscColorSchema,
  playerId: z.string(),
  sequence: z.number().int().positive(),
}).nullable();
export type LastMove = z.infer<typeof LastMoveSchema>;

export const GameSnapshotSchema = z.object({
  id: z.string().uuid(),
  status: GameStatusSchema,
  board: BoardSchema,
  players: z.array(PublicPlayerSchema).min(1).max(2),
  hostUserId: z.string(),
  currentTurnUserId: z.string().nullable(),
  winnerUserId: z.string().nullable(),
  endReason: GameEndReasonSchema,
  moveCount: z.number().int().min(0).max(42),
  stateVersion: z.number().int().nonnegative(),
  turnSeconds: TurnSecondsSchema,
  turnDeadlineAt: z.string().datetime().nullable(),
  inviteCode: z.string().nullable(),
  inviteExpiresAt: z.string().datetime().nullable(),
  rematchRequestedBy: z.array(z.string()),
  seriesId: z.string().uuid(),
  rematchOfId: z.string().uuid().nullable(),
  lastMove: LastMoveSchema,
  winningCells: z.array(CoordinateSchema),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  endedAt: z.string().datetime().nullable(),
  serverTime: z.string().datetime(),
});
export type GameSnapshot = z.infer<typeof GameSnapshotSchema>;

export const GameListItemSchema = GameSnapshotSchema.pick({
  id: true,
  status: true,
  players: true,
  hostUserId: true,
  winnerUserId: true,
  endReason: true,
  turnSeconds: true,
  turnDeadlineAt: true,
  inviteCode: true,
  inviteExpiresAt: true,
  createdAt: true,
  startedAt: true,
  endedAt: true,
});
export type GameListItem = z.infer<typeof GameListItemSchema>;

export const InvitePreviewSchema = z.object({
  hostUsername: z.string(),
  turnSeconds: TurnSecondsSchema,
  status: GameStatusSchema,
  expiresAt: z.string().datetime(),
});
export type InvitePreview = z.infer<typeof InvitePreviewSchema>;

export const CreateGameInputSchema = z.object({ turnSeconds: TurnSecondsSchema });
export type CreateGameInput = z.infer<typeof CreateGameInputSchema>;

export const GameListQuerySchema = z.object({
  status: z.enum(["active", "completed"]).default("active"),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type GameListQuery = z.infer<typeof GameListQuerySchema>;

export const SubscribeCommandSchema = z.object({ gameId: z.string().uuid() });
export const MoveCommandSchema = z.object({
  gameId: z.string().uuid(),
  commandId: z.string().uuid(),
  column: z.number().int().min(0).max(6),
  expectedVersion: z.number().int().nonnegative(),
});
export const ResignCommandSchema = z.object({
  gameId: z.string().uuid(),
  commandId: z.string().uuid(),
});
export const RematchCommandSchema = z.object({
  gameId: z.string().uuid(),
  commandId: z.string().uuid(),
  requested: z.boolean().default(true),
});

export type SubscribeCommand = z.infer<typeof SubscribeCommandSchema>;
export type MoveCommand = z.infer<typeof MoveCommandSchema>;
export type ResignCommand = z.infer<typeof ResignCommandSchema>;
export type RematchCommand = z.infer<typeof RematchCommandSchema>;

export const ApiErrorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "EMAIL_NOT_VERIFIED",
  "FORBIDDEN",
  "GAME_NOT_FOUND",
  "GAME_FULL",
  "GAME_FINISHED",
  "INVITE_EXPIRED",
  "NOT_YOUR_TURN",
  "COLUMN_FULL",
  "CLOCK_EXPIRED",
  "STALE_VERSION",
  "RATE_LIMITED",
  "VALIDATION_ERROR",
  "INTERNAL_ERROR",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export type CommandResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: ApiErrorCode; message: string } };

export interface GameListResponse {
  items: GameListItem[];
  nextCursor: string | null;
}

export interface CreateGameResponse {
  game: GameSnapshot;
  inviteUrl: string;
}

export interface PresenceEvent {
  gameId: string;
  connectedUserIds: string[];
}

export interface RematchCreatedEvent {
  previousGameId: string;
  game: GameSnapshot;
}

type Ack<T> = (result: CommandResult<T>) => void;

export interface ClientToServerEvents {
  "game:subscribe": (command: SubscribeCommand, ack: Ack<GameSnapshot>) => void;
  "game:move": (command: MoveCommand, ack: Ack<GameSnapshot>) => void;
  "game:resign": (command: ResignCommand, ack: Ack<GameSnapshot>) => void;
  "game:rematch-request": (
    command: RematchCommand,
    ack: Ack<{ game: GameSnapshot; nextGame: GameSnapshot | null }>,
  ) => void;
}

export interface ServerToClientEvents {
  "game:state": (game: GameSnapshot) => void;
  "game:presence": (presence: PresenceEvent) => void;
  "game:rematch-created": (event: RematchCreatedEvent) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  userId: string;
  username: string;
}

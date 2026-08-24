CREATE TYPE "public"."game_end_reason" AS ENUM('connect_four', 'draw', 'resignation', 'timeout', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."game_status" AS ENUM('waiting', 'active', 'completed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_provider_account_unique" UNIQUE("provider_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "game_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"player_id" text NOT NULL,
	"command_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"column" integer NOT NULL,
	"row" integer NOT NULL,
	"color" varchar(6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_moves_sequence_unique" UNIQUE("game_id","sequence"),
	CONSTRAINT "game_moves_command_unique" UNIQUE("game_id","player_id","command_id"),
	CONSTRAINT "game_moves_column_check" CHECK ("game_moves"."column" between 0 and 6),
	CONSTRAINT "game_moves_row_check" CHECK ("game_moves"."row" between 0 and 5),
	CONSTRAINT "game_moves_color_check" CHECK ("game_moves"."color" in ('red', 'yellow'))
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"rematch_of_id" uuid,
	"invite_code" varchar(32) NOT NULL,
	"invite_expires_at" timestamp with time zone NOT NULL,
	"status" "game_status" DEFAULT 'waiting' NOT NULL,
	"end_reason" "game_end_reason",
	"host_user_id" text NOT NULL,
	"guest_user_id" text,
	"red_user_id" text,
	"yellow_user_id" text,
	"current_turn_user_id" text,
	"winner_user_id" text,
	"board" jsonb NOT NULL,
	"winning_cells" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"move_count" integer DEFAULT 0 NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"turn_seconds" integer NOT NULL,
	"turn_deadline_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_turn_seconds_check" CHECK ("games"."turn_seconds" in (30, 60, 120)),
	CONSTRAINT "games_move_count_check" CHECK ("games"."move_count" between 0 and 42),
	CONSTRAINT "games_players_distinct_check" CHECK ("games"."guest_user_id" is null or "games"."guest_user_id" <> "games"."host_user_id")
);
--> statement-breakpoint
CREATE TABLE "rematch_requests" (
	"game_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rematch_requests_game_id_user_id_pk" PRIMARY KEY("game_id","user_id"),
	CONSTRAINT "rematch_command_unique" UNIQUE("game_id","user_id","command_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"username" varchar(20),
	"display_username" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_moves" ADD CONSTRAINT "game_moves_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_moves" ADD CONSTRAINT "game_moves_player_id_user_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_rematch_of_id_games_id_fk" FOREIGN KEY ("rematch_of_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_host_user_id_user_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_guest_user_id_user_id_fk" FOREIGN KEY ("guest_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_red_user_id_user_id_fk" FOREIGN KEY ("red_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_yellow_user_id_user_id_fk" FOREIGN KEY ("yellow_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_current_turn_user_id_user_id_fk" FOREIGN KEY ("current_turn_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_winner_user_id_user_id_fk" FOREIGN KEY ("winner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rematch_requests" ADD CONSTRAINT "rematch_requests_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rematch_requests" ADD CONSTRAINT "rematch_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "game_moves_game_idx" ON "game_moves" USING btree ("game_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "games_invite_code_idx" ON "games" USING btree ("invite_code");--> statement-breakpoint
CREATE INDEX "games_active_deadline_idx" ON "games" USING btree ("status","turn_deadline_at");--> statement-breakpoint
CREATE INDEX "games_host_history_idx" ON "games" USING btree ("host_user_id","created_at");--> statement-breakpoint
CREATE INDEX "games_guest_history_idx" ON "games" USING btree ("guest_user_id","created_at");--> statement-breakpoint
CREATE INDEX "games_series_idx" ON "games" USING btree ("series_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_idx" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_idx" ON "user" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "user_username_idx" ON "user" USING btree ("username");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");
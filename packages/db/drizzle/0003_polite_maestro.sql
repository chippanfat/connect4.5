CREATE TYPE "public"."friendship_status" AS ENUM('pending', 'accepted', 'closed');--> statement-breakpoint
ALTER TYPE "public"."game_end_reason" ADD VALUE 'declined' BEFORE 'expired';--> statement-breakpoint
CREATE TABLE "friendships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_a_id" text NOT NULL,
	"user_b_id" text NOT NULL,
	"status" "friendship_status" DEFAULT 'pending' NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"closed_by_user_id" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friendships_pair_unique" UNIQUE("user_a_id","user_b_id"),
	CONSTRAINT "friendships_pair_order_check" CHECK ("friendships"."user_a_id" < "friendships"."user_b_id"),
	CONSTRAINT "friendships_requester_member_check" CHECK ("friendships"."requested_by_user_id" in ("friendships"."user_a_id", "friendships"."user_b_id")),
	CONSTRAINT "friendships_closer_member_check" CHECK ("friendships"."closed_by_user_id" is null or "friendships"."closed_by_user_id" in ("friendships"."user_a_id", "friendships"."user_b_id"))
);
--> statement-breakpoint
ALTER TABLE "games" ALTER COLUMN "invite_code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "invited_user_id" text;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_a_id_user_id_fk" FOREIGN KEY ("user_a_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_b_id_user_id_fk" FOREIGN KEY ("user_b_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_closed_by_user_id_user_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "friendships_user_a_idx" ON "friendships" USING btree ("user_a_id","status");--> statement-breakpoint
CREATE INDEX "friendships_user_b_idx" ON "friendships" USING btree ("user_b_id","status");--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_invited_user_id_user_id_fk" FOREIGN KEY ("invited_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "games_invited_user_idx" ON "games" USING btree ("invited_user_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "games_pending_friend_pair_idx" ON "games" USING btree (least("host_user_id", "invited_user_id"),greatest("host_user_id", "invited_user_id")) WHERE "games"."status" = 'waiting' and "games"."invited_user_id" is not null;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_invited_user_distinct_check" CHECK ("games"."invited_user_id" is null or "games"."invited_user_id" <> "games"."host_user_id");--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_invitation_kind_check" CHECK (("games"."invited_user_id" is null and "games"."invite_code" is not null) or ("games"."invited_user_id" is not null and "games"."invite_code" is null));
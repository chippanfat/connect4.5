ALTER TABLE "account" DROP CONSTRAINT "account_provider_account_unique";--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "issuer" text NOT NULL;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_issuer_account_unique" UNIQUE("issuer","account_id");
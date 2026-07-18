ALTER TABLE "api_credentials" ADD COLUMN "demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bots" ADD COLUMN "credential_name" text;--> statement-breakpoint
UPDATE "api_credentials" SET "demo" = true WHERE "name" = 'testnet';

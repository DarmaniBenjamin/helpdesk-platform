ALTER TABLE "customers" ALTER COLUMN "id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "id" SET MAXVALUE 9223372036854775807;--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ALTER COLUMN "customer_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "customer_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;
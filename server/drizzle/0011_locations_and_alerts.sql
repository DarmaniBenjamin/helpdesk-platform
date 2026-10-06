ALTER TABLE "customers" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "location_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "location_by" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "location_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_agents" ADD COLUMN "ack_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_agents" ADD COLUMN "alerts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job_agents" ADD COLUMN "last_alert_at" timestamp with time zone;
CREATE TABLE "reminders" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reminders_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"remind_at" timestamp with time zone NOT NULL,
	"repeat" text DEFAULT 'none' NOT NULL,
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"everyone" boolean DEFAULT true NOT NULL,
	"user_ids" text[] DEFAULT '{}' NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT '' NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reminders_at_idx" ON "reminders" USING btree ("remind_at");
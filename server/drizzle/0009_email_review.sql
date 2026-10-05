CREATE TABLE "held_emails" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "held_emails_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"mailbox_id" integer,
	"message_id" text NOT NULL,
	"from_address" text NOT NULL,
	"from_name" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"reason" text NOT NULL,
	"raw_file" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "held_emails_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "mailboxes" ADD COLUMN "new_tickets_from" text DEFAULT 'known' NOT NULL;--> statement-breakpoint
ALTER TABLE "held_emails" ADD CONSTRAINT "held_emails_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailboxes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "held_emails_received_idx" ON "held_emails" USING btree ("received_at");
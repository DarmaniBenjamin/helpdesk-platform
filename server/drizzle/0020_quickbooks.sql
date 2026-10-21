ALTER TABLE "customers" ADD COLUMN "qbo_customer_id" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "bill_in_quickbooks" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "qbo_invoice_id" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "qbo_invoice_number" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "qbo_error" text;